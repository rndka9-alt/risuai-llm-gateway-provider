import {
  Llm,
  LlmHttpError,
  LLMGatewayProvider,
  OpenAIChatCompletionsFormat,
  type LlmMessage,
  type LlmRequestOptions,
  type LlmUsage,
  type OpenAIChatCompletionsExtraBody,
  type OpenAIChatCompletionsRaw,
} from 'llm-io';
import {
  PROMPT_CACHE_MODE_ARGUMENT,
  type CacheAnchorState,
  type CacheBackoffTransition,
  createPromptCacheExtraBody,
  isExplicitPromptCacheMode,
  loadCacheAnchorState,
  markCacheBreakpoints,
  planCacheAnchors,
  resolveCacheBackoffTransition,
  resolvePromptCacheMode,
  saveCacheAnchorState,
} from './cache';
import { toLlmMessages } from './convert';
import { accumulateCacheUsage } from './ledger';
import {
  DEFAULT_MODEL,
  FLAGS_ARGUMENT,
  REASONING_EFFORT_ARGUMENT,
  RISUAI_TIKTOKEN_O200_BASE_TOKENIZER,
  SERVICE_TIER_ARGUMENT,
  STREAMING_MODE_ARGUMENT,
  VERBOSITY_ARGUMENT,
  resolveConfigurableLlmFlagNames,
  resolveProviderLlmFlags,
  resolveReasoningEffort,
  resolveServiceTier,
  resolveStreamingMode,
  resolveVerbosity,
  type ConfigurableLlmFlagName,
  type StreamingMode,
} from './options';
import { openSettings } from './settings';
import { showCacheBackoffToast } from './toast';

declare const __VERSION__: string;

const PROVIDER_NAME = 'LLM Gateway';

type GatewayClient = Llm<OpenAIChatCompletionsRaw>;

interface GatewayRequestContext {
  abortSignal: AbortSignal | undefined;
  gatewayClient: GatewayClient;
  messages: readonly LlmMessage[];
  requestOptions: LlmRequestOptions;
}

interface StreamConsumptionResult {
  text: string;
  usage: LlmUsage | undefined;
}

interface ProviderRegistrationSettings {
  flagNames: readonly ConfigurableLlmFlagName[];
}

async function readArgument(key: string): Promise<string | undefined> {
  const value = await risuai.getArgument(key);
  if (typeof value !== 'string') return undefined;

  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function toFailureContent(error: unknown): string {
  if (error instanceof LlmHttpError) {
    return `LLM Gateway 요청 실패 (HTTP ${error.status})\n${error.body}`;
  }
  if (error instanceof Error) {
    return `LLM Gateway 요청 실패: ${error.message}`;
  }
  return `LLM Gateway 요청 실패: ${String(error)}`;
}

async function consumeGatewayStream(
  context: GatewayRequestContext,
): Promise<StreamConsumptionResult> {
  const stream = context.gatewayClient.stream({
    messages: context.messages,
    options: context.requestOptions,
    signal: context.abortSignal,
  });
  const reader = stream.getReader();
  let text = '';
  let usage: LlmUsage | undefined;

  try {
    while (true) {
      context.abortSignal?.throwIfAborted();
      const result = await reader.read();
      context.abortSignal?.throwIfAborted();
      if (result.done) break;

      const event = result.value;
      if (event.type === 'text-delta') {
        text += event.text;
      } else if (event.type === 'usage') {
        usage = event.usage;
      } else if (event.type === 'done' && event.usage !== undefined) {
        usage = event.usage;
      }
    }
  } finally {
    try {
      if (context.abortSignal?.aborted === true) {
        await reader.cancel(context.abortSignal.reason);
      }
    } finally {
      reader.releaseLock();
    }
  }

  return { text, usage };
}

async function completeSuccessfulRequest(
  nextCacheAnchorState: CacheAnchorState | null,
  cacheBackoffTransition: CacheBackoffTransition | null,
  usage: LlmUsage | undefined,
  rawResponse: unknown,
  model: string,
  requestedServiceTier: string | undefined,
): Promise<void> {
  if (nextCacheAnchorState !== null) {
    try {
      // 실패 응답이나 미완료 스트림이 다음 diff의 기준을 오염시키지 않도록 완료 뒤에만 저장한다.
      await saveCacheAnchorState(nextCacheAnchorState);
      if (cacheBackoffTransition !== null) {
        await showCacheBackoffToast(cacheBackoffTransition);
      }
    } catch (error) {
      console.error('[llm-gateway-provider] cache anchor state update failed', error);
    }
  }

  try {
    await accumulateCacheUsage(usage, rawResponse, model, requestedServiceTier);
  } catch (error) {
    // 손익 집계 실패로 응답 전달을 막지 않는다.
    console.error('[llm-gateway-provider] cache ledger update failed', error);
  }
}

async function requestLLMGateway(
  providerArguments: ProviderArguments,
  abortSignal?: AbortSignal,
): Promise<ProviderResponse> {
  // hasStreaming flag 자동 선언이 사라져 등록 스냅샷과 무관해졌으므로,
  // 스트리밍 모드는 매 요청 라이브로 읽어 저장 즉시 반영한다 (새로고침 불필요).
  const streamingMode = resolveStreamingMode(await readArgument(STREAMING_MODE_ARGUMENT));
  const apiKey = await readArgument('api_key');

  if (apiKey === undefined) {
    return {
      success: false,
      content: '플러그인 설정에서 api_key를 입력해주세요.',
    };
  }

  // 설정 UI는 모델 기본값을 표시만 하고 사용자가 바꾸기 전엔 저장하지 않으므로
  // (change 시점 즉시 저장), 미설정이면 표시값과 같은 기본 모델을 사용한다.
  const model = (await readArgument('model')) ?? DEFAULT_MODEL;

  const baseUrl = await readArgument('base_url');
  const promptCacheMode = resolvePromptCacheMode(await readArgument(PROMPT_CACHE_MODE_ARGUMENT));
  const serviceTier = resolveServiceTier(await readArgument(SERVICE_TIER_ARGUMENT));
  const reasoningEffort = resolveReasoningEffort(await readArgument(REASONING_EFFORT_ARGUMENT));
  const verbosity = resolveVerbosity(await readArgument(VERBOSITY_ARGUMENT));
  const messages = toLlmMessages(providerArguments.prompt_chat);
  let requestMessages = messages;
  let nextCacheAnchorState: CacheAnchorState | null = null;
  let cacheBackoffTransition: CacheBackoffTransition | null = null;
  try {
    // disabled 모드에서도 diff 기준은 계속 갱신한다 — explicit로 되돌렸을 때
    // 스테일 diff로 잘못된 앵커가 잡히는 것을 막는다.
    const previousCacheAnchorState = await loadCacheAnchorState();
    const cachePlan = planCacheAnchors(previousCacheAnchorState, messages);
    if (isExplicitPromptCacheMode(promptCacheMode)) {
      requestMessages = markCacheBreakpoints(messages, cachePlan);
    }
    nextCacheAnchorState = cachePlan.nextState;
    cacheBackoffTransition = resolveCacheBackoffTransition(
      previousCacheAnchorState,
      cachePlan.nextState,
    );
  } catch (error) {
    // 앵커 처리 실패가 채팅 요청까지 죽여선 안 된다 — 이번 요청은 캐시 없이 보낸다.
    console.error(
      '[llm-gateway-provider] cache anchor handling failed; sending without breakpoints',
      error,
    );
  }

  const extraBody: OpenAIChatCompletionsExtraBody = {
    ...createPromptCacheExtraBody(promptCacheMode),
    ...(serviceTier === undefined ? {} : { service_tier: serviceTier }),
    // RisuAI 본체는 custom provider 인자를 고정 목록으로 만들어 이 두 값을 전달하지 않는다.
    // 따라서 플러그인 인자가 Chat Completions body로 보낼 수 있는 유일한 경로다.
    ...(reasoningEffort === undefined ? {} : { reasoning_effort: reasoningEffort }),
    ...(verbosity === undefined ? {} : { verbosity }),
    // RisuAI가 이미 /100 스케일링한 값이므로 변환 없이 전달한다.
    ...(providerArguments.frequency_penalty === undefined
      ? {}
      : { frequency_penalty: providerArguments.frequency_penalty }),
    ...(providerArguments.presence_penalty === undefined
      ? {}
      : { presence_penalty: providerArguments.presence_penalty }),
    ...(streamingMode === 'off' ? {} : { stream_options: { include_usage: true } }),
  };
  const gatewayClient: GatewayClient = new Llm({
    format: new OpenAIChatCompletionsFormat({ model, extraBody }),
    provider: new LLMGatewayProvider(baseUrl === undefined ? { apiKey } : { apiKey, baseUrl }),
    // 플러그인 iframe은 CSP(connect-src 'none')로 직접 fetch가 막혀 있어
    // RisuAI 브릿지를 경유한다.
    fetch: (url, requestInit) => risuai.nativeFetch(url, requestInit),
  });
  const requestOptions: LlmRequestOptions = {
    maxTokens: providerArguments.max_tokens,
    temperature: providerArguments.temperature,
    topP: providerArguments.top_p,
  };
  const context: GatewayRequestContext = {
    abortSignal,
    gatewayClient,
    messages: requestMessages,
    requestOptions,
  };

  try {
    if (streamingMode === 'decoupled') {
      // 연결은 streaming으로 유지해 중간 응답 제한을 피하되, RisuAI에는 완성 문자열만 반환한다.
      const result = await consumeGatewayStream(context);
      await completeSuccessfulRequest(
        nextCacheAnchorState,
        cacheBackoffTransition,
        result.usage,
        undefined,
        model,
        serviceTier,
      );
      return { success: true, content: result.text };
    }

    const output = await context.gatewayClient.generate({
      messages: context.messages,
      options: context.requestOptions,
      signal: context.abortSignal,
    });
    await completeSuccessfulRequest(
      nextCacheAnchorState,
      cacheBackoffTransition,
      output.usage,
      output.raw,
      model,
      serviceTier,
    );
    return { success: true, content: output.message.text };
  } catch (error) {
    return { success: false, content: toFailureContent(error) };
  }
}

async function main(): Promise<void> {
  const registrationSettings: ProviderRegistrationSettings = {
    flagNames: resolveConfigurableLlmFlagNames(await readArgument(FLAGS_ARGUMENT)),
  };
  await risuai.addProvider(
    PROVIDER_NAME,
    (providerArguments, abortSignal) => requestLLMGateway(providerArguments, abortSignal),
    {
      // RisuAI src/ts/tokenizer.ts가 custom provider의 o200k_base 문자열을 직접 소비한다.
      tokenizer: 'o200k_base',
      model: {
        name: PROVIDER_NAME,
        flags: resolveProviderLlmFlags(registrationSettings.flagNames),
        parameters: ['temperature', 'top_p', 'frequency_penalty', 'presence_penalty'],
        tokenizer: RISUAI_TIKTOKEN_O200_BASE_TOKENIZER,
      },
    },
  );
  const settingsRegistration = await risuai.registerSetting(
    'LLM Gateway',
    () => openSettings(registrationSettings),
    '&#x1f511;',
    'html',
    'llm-gateway-settings',
  );
  await risuai.onUnload(() => risuai.unregisterUIPart(settingsRegistration.id));
  console.log(`[llm-gateway-provider] v${__VERSION__} loaded`);
}

void main();
