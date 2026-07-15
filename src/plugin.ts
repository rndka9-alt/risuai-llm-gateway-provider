import {
  Llm,
  LlmHttpError,
  LLMGatewayProvider,
  OpenAIChatCompletionsFormat,
  type LlmMessage,
  type LlmOutput,
  type LlmRequestOptions,
  type LlmUsage,
  type OpenAIChatCompletionsExtraBody,
  type OpenAIChatCompletionsRaw,
} from 'llm-io';
import {
  PROMPT_CACHE_MODE_ARGUMENT,
  type CacheAnchorState,
  createPromptCacheExtraBody,
  isExplicitPromptCacheMode,
  loadCacheAnchorState,
  markCacheBreakpoints,
  planCacheAnchors,
  resolvePromptCacheMode,
  saveCacheAnchorState,
} from './cache';
import { toLlmMessages } from './convert';
import { accumulateCacheUsage } from './ledger';
import {
  FLAGS_ARGUMENT,
  REASONING_EFFORT_ARGUMENT,
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

declare const __VERSION__: string;

const PROVIDER_NAME = 'LLM Gateway';

// 실제 오류 문구가 충분히 쌓이면 조건을 좁힐 수 있도록 감지 문자열을 한곳에 둔다.
const PROMPT_CACHE_ERROR_HINT = 'prompt_cache';
const CACHE_ERROR_HINT = 'cache';
const BREAKPOINT_ERROR_HINT = 'breakpoint';

type GatewayClient = Llm<OpenAIChatCompletionsRaw>;

interface GatewayRequestContext {
  abortSignal: AbortSignal | undefined;
  gatewayClient: GatewayClient;
  markedMessages: readonly LlmMessage[];
  originalMessages: readonly LlmMessage[];
  requestOptions: LlmRequestOptions;
}

interface StreamConsumptionResult {
  text: string;
  usage: LlmUsage | undefined;
}

interface ProviderRegistrationSettings {
  flagNames: readonly ConfigurableLlmFlagName[];
  streamingMode: StreamingMode;
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

function containsCacheBreakpoint(messages: readonly LlmMessage[]): boolean {
  return messages.some((message) =>
    message.content.some(
      (part) => part.type === 'text' && part.cacheBreakpoint !== undefined,
    ),
  );
}

function shouldRetryWithoutCacheBreakpoints(error: unknown, markedBreakpoints: boolean): boolean {
  if (!markedBreakpoints || !(error instanceof LlmHttpError) || error.status !== 400) return false;

  const normalizedBody = error.body.toLowerCase();
  return (
    normalizedBody.includes(PROMPT_CACHE_ERROR_HINT) ||
    (normalizedBody.includes(CACHE_ERROR_HINT) && normalizedBody.includes(BREAKPOINT_ERROR_HINT))
  );
}

function warnCacheBreakpointRetry(): void {
  console.warn(
    '[llm-gateway-provider] cache breakpoint rejected; retrying once without breakpoints',
  );
}

async function generateWithCacheRetry(
  context: GatewayRequestContext,
): Promise<LlmOutput<OpenAIChatCompletionsRaw>> {
  try {
    return await context.gatewayClient.generate({
      messages: context.markedMessages,
      options: context.requestOptions,
      signal: context.abortSignal,
    });
  } catch (error) {
    if (!shouldRetryWithoutCacheBreakpoints(
      error,
      containsCacheBreakpoint(context.markedMessages),
    )) {
      throw error;
    }
    warnCacheBreakpointRetry();
    return context.gatewayClient.generate({
      messages: context.originalMessages,
      options: context.requestOptions,
      signal: context.abortSignal,
    });
  }
}

async function consumeGatewayStream(
  context: GatewayRequestContext,
  messages: readonly LlmMessage[],
  onTextDelta?: (text: string) => void,
): Promise<StreamConsumptionResult> {
  const stream = context.gatewayClient.stream({
    messages,
    options: context.requestOptions,
    signal: context.abortSignal,
  });
  const reader = stream.getReader();
  let text = '';
  let usage: LlmUsage | undefined;

  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;

      const event = result.value;
      if (event.type === 'text-delta') {
        text += event.text;
        onTextDelta?.(event.text);
      } else if (event.type === 'usage') {
        usage = event.usage;
      } else if (event.type === 'done' && event.usage !== undefined) {
        usage = event.usage;
      }
    }
  } finally {
    reader.releaseLock();
  }

  return { text, usage };
}

async function consumeStreamWithCacheRetry(
  context: GatewayRequestContext,
  onTextDelta?: (text: string) => void,
): Promise<StreamConsumptionResult> {
  try {
    return await consumeGatewayStream(context, context.markedMessages, onTextDelta);
  } catch (error) {
    if (!shouldRetryWithoutCacheBreakpoints(
      error,
      containsCacheBreakpoint(context.markedMessages),
    )) {
      throw error;
    }
    warnCacheBreakpointRetry();
    return consumeGatewayStream(context, context.originalMessages, onTextDelta);
  }
}

async function completeSuccessfulRequest(
  nextCacheAnchorState: CacheAnchorState | null,
  usage: LlmUsage | undefined,
  rawResponse: unknown,
  model: string,
): Promise<void> {
  if (nextCacheAnchorState !== null) {
    try {
      // 실패 응답이나 미완료 스트림이 다음 diff의 기준을 오염시키지 않도록 완료 뒤에만 저장한다.
      await saveCacheAnchorState(nextCacheAnchorState);
    } catch (error) {
      console.error('[llm-gateway-provider] cache anchor state update failed', error);
    }
  }

  try {
    await accumulateCacheUsage(usage, rawResponse, model);
  } catch (error) {
    // 손익 집계 실패로 응답 전달을 막지 않는다.
    console.error('[llm-gateway-provider] cache ledger update failed', error);
  }
}

function createProviderTextStream(
  context: GatewayRequestContext,
  nextCacheAnchorState: CacheAnchorState | null,
  model: string,
): ReadableStream<string> {
  return new ReadableStream<string>({
    async start(controller) {
      try {
        const result = await consumeStreamWithCacheRetry(
          context,
          (text) => controller.enqueue(text),
        );
        await completeSuccessfulRequest(nextCacheAnchorState, result.usage, undefined, model);
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
}

async function requestLLMGateway(
  providerArguments: ProviderArguments,
  streamingMode: StreamingMode,
  abortSignal?: AbortSignal,
): Promise<ProviderResponse> {
  const apiKey = await readArgument('api_key');
  const model = await readArgument('model');

  if (apiKey === undefined || model === undefined) {
    return {
      success: false,
      content: '플러그인 설정에서 api_key와 model 인자를 입력해주세요.',
    };
  }

  const baseUrl = await readArgument('base_url');
  const promptCacheMode = resolvePromptCacheMode(await readArgument(PROMPT_CACHE_MODE_ARGUMENT));
  const serviceTier = resolveServiceTier(await readArgument(SERVICE_TIER_ARGUMENT));
  const reasoningEffort = resolveReasoningEffort(await readArgument(REASONING_EFFORT_ARGUMENT));
  const verbosity = resolveVerbosity(await readArgument(VERBOSITY_ARGUMENT));
  const messages = toLlmMessages(providerArguments.prompt_chat);
  let requestMessages = messages;
  let nextCacheAnchorState: CacheAnchorState | null = null;
  try {
    // disabled 모드에서도 diff 기준은 계속 갱신한다 — explicit로 되돌렸을 때
    // 스테일 diff로 잘못된 앵커가 잡히는 것을 막는다.
    const cachePlan = planCacheAnchors(await loadCacheAnchorState(), messages);
    if (isExplicitPromptCacheMode(promptCacheMode)) {
      requestMessages = markCacheBreakpoints(messages, cachePlan);
    }
    nextCacheAnchorState = cachePlan.nextState;
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
    markedMessages: requestMessages,
    originalMessages: messages,
    requestOptions,
  };

  try {
    if (streamingMode === 'stream') {
      // llm-io stream을 그대로 노출하지 않고 text delta만 전달한다. usage는 옆으로 빼
      // 원장에 반영하고, 앵커 상태는 upstream stream이 끝난 뒤에만 확정한다.
      return {
        success: true,
        content: createProviderTextStream(context, nextCacheAnchorState, model),
      };
    }

    if (streamingMode === 'decoupled') {
      // 연결은 streaming으로 유지해 중간 응답 제한을 피하되, RisuAI에는 완성 문자열만 반환한다.
      const result = await consumeStreamWithCacheRetry(context);
      await completeSuccessfulRequest(nextCacheAnchorState, result.usage, undefined, model);
      return { success: true, content: result.text };
    }

    const output = await generateWithCacheRetry(context);
    await completeSuccessfulRequest(nextCacheAnchorState, output.usage, output.raw, model);
    return { success: true, content: output.message.text };
  } catch (error) {
    return { success: false, content: toFailureContent(error) };
  }
}

async function main(): Promise<void> {
  const registrationSettings: ProviderRegistrationSettings = {
    flagNames: resolveConfigurableLlmFlagNames(await readArgument(FLAGS_ARGUMENT)),
    streamingMode: resolveStreamingMode(await readArgument(STREAMING_MODE_ARGUMENT)),
  };
  await risuai.addProvider(
    PROVIDER_NAME,
    (providerArguments, abortSignal) =>
      requestLLMGateway(providerArguments, registrationSettings.streamingMode, abortSignal),
    {
      // RisuAI src/ts/tokenizer.ts가 custom provider의 o200k_base 문자열을 직접 소비한다.
      tokenizer: 'o200k_base',
      model: {
        name: PROVIDER_NAME,
        flags: resolveProviderLlmFlags(
          registrationSettings.flagNames,
          registrationSettings.streamingMode,
        ),
        parameters: ['temperature', 'top_p', 'frequency_penalty', 'presence_penalty'],
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
