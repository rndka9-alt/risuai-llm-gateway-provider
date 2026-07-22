import {
  Llm,
  LLMGatewayProvider,
  OpenAIChatCompletionsFormat,
  type LlmMessage,
  type LlmRequestOptions,
  type LlmUsage,
  type OpenAIChatCompletionsExtraBody,
  type OpenAIChatCompletionsRaw,
} from 'llm-io';
import { createBridgeFetch } from './bridge-fetch';
import {
  type PendingPromptCacheCommit,
  commitPromptCacheState,
  loadCacheAnchorBankSnapshot,
  preparePromptCacheRequest,
  resolvePromptCacheMode,
} from './cache';
import {
  API_KEY_ARGUMENT,
  EXTRA_BODY_ARGUMENT,
  FLAGS_ARGUMENT,
  MODEL_ARGUMENT,
  PROMPT_CACHE_MODE_ARGUMENT,
  REASONING_EFFORT_ARGUMENT,
  SERVICE_TIER_ARGUMENT,
  STREAMING_MODE_ARGUMENT,
  VERBOSITY_ARGUMENT,
  initializeConfigOnStartup,
  loadConfig,
} from './config';
import { toLlmMessages } from './convert';
import { applyCustomExtraBody } from './extra-body';
import { toFailureContent } from './failure-content';
import { accumulateCacheUsage } from './ledger';
import {
  DEFAULT_MODEL,
  RISUAI_TIKTOKEN_O200_BASE_TOKENIZER,
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

/** llmgateway.io는 출력 제한을 max_tokens로 받지만 llm-io의 maxTokens는
 * max_completion_tokens로 직렬화하므로 Gateway 전용 필드를 extraBody로 전달한다. */
interface GatewayChatCompletionsExtraBody extends OpenAIChatCompletionsExtraBody {
  max_tokens: number;
}

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
  pendingPromptCacheCommit: PendingPromptCacheCommit | null,
  usage: LlmUsage | undefined,
  rawResponse: unknown,
  model: string,
  requestedServiceTier: string | undefined,
): Promise<void> {
  if (pendingPromptCacheCommit !== null) {
    // 실패 응답이나 미완료 스트림이 다음 diff의 기준을 오염시키지 않도록 완료 뒤에만 저장한다.
    const cacheBackoffTransition = await commitPromptCacheState(pendingPromptCacheCommit);
    if (cacheBackoffTransition !== null) {
      await showCacheBackoffToast(cacheBackoffTransition);
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
  const config = await loadConfig();
  // hasStreaming flag 자동 선언이 사라져 등록 스냅샷과 무관해졌으므로,
  // 스트리밍 모드는 매 요청 라이브로 읽어 저장 즉시 반영한다 (새로고침 불필요).
  const streamingMode = resolveStreamingMode(config[STREAMING_MODE_ARGUMENT]);
  const apiKey = config[API_KEY_ARGUMENT].trim();

  if (apiKey === '') {
    return {
      success: false,
      content:
        'LLM Gateway API 키가 설정되어 있지 않아요.\n플러그인 설정에서 API 키를 입력해 주세요.',
    };
  }

  // 설정 UI는 모델 기본값을 표시만 하고 사용자가 바꾸기 전엔 저장하지 않으므로
  // (change 시점 즉시 저장), 미설정이면 표시값과 같은 기본 모델을 사용한다.
  const storedModel = config[MODEL_ARGUMENT].trim();
  const model = storedModel === '' ? DEFAULT_MODEL : storedModel;

  const promptCacheMode = resolvePromptCacheMode(config[PROMPT_CACHE_MODE_ARGUMENT]);
  const serviceTier = resolveServiceTier(config[SERVICE_TIER_ARGUMENT]);
  const reasoningEffort = resolveReasoningEffort(config[REASONING_EFFORT_ARGUMENT]);
  const verbosity = resolveVerbosity(config[VERBOSITY_ARGUMENT]);
  // 메시지 변환·커스텀 body 병합 예외(미지원 미디어, 초심층 JSON 등)도 promise reject가
  // 아니라 provider 실패 응답({success:false})으로 수렴해야 RisuAI가 처리할 수 있다
  try {
    const messages = toLlmMessages(providerArguments.prompt_chat);
    const cacheRequest = await preparePromptCacheRequest(messages, promptCacheMode);

    const extraBody: GatewayChatCompletionsExtraBody = {
      max_tokens: providerArguments.max_tokens,
      ...cacheRequest.cacheExtraBody,
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
    // 설정 편집기의 커스텀 body(JSON)를 요청 직전에 deep merge한다 — 겹치는 필드는 커스텀이
    // 우선하고, invalid JSON이면 이번 요청에서는 통째로 무시된다 (extra-body.ts 계약)
    const requestExtraBody = applyCustomExtraBody(extraBody, config[EXTRA_BODY_ARGUMENT]);
    const gatewayClient: GatewayClient = new Llm({
      format: new OpenAIChatCompletionsFormat({ model, extraBody: requestExtraBody }),
      // 엔드포인트는 llm-io 기본값(공식 llmgateway.io)으로 고정한다. 인자로 열어두면
      // 타 플러그인이 v2 setArg로 바꿔칠 수 있어 api_key가 임의 주소로 전송될 수 있다.
      provider: new LLMGatewayProvider({ apiKey }),
      // 플러그인 iframe은 CSP(connect-src 'none')로 직접 fetch가 막혀 있어
      // RisuAI 브릿지를 경유한다. transferable streams 미지원 브라우저(Safari 26 이하)는
      // nativeFetch의 Response 전달이 실패하므로 risuFetch 폴백 경로를 쓴다.
      fetch: createBridgeFetch(),
    });
    const requestOptions: LlmRequestOptions = {
      temperature: providerArguments.temperature,
      topP: providerArguments.top_p,
    };
    const context: GatewayRequestContext = {
      abortSignal,
      gatewayClient,
      messages: cacheRequest.requestMessages,
      requestOptions,
    };

    if (streamingMode === 'decoupled') {
      // 연결은 streaming으로 유지해 중간 응답 제한을 피하되, RisuAI에는 완성 문자열만 반환한다.
      const result = await consumeGatewayStream(context);
      await completeSuccessfulRequest(
        cacheRequest.pendingCommit,
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
      cacheRequest.pendingCommit,
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
  // 상주 iframe의 부팅 구간에서 샤드 snapshot을 미리 채워 첫 메시지의 cold-load를 피한다.
  // 실패 시 snapshot이 발행되지 않아 요청 경로의 기존 lazy load가 다시 시도한다.
  void loadCacheAnchorBankSnapshot().catch((error) => {
    console.error('[llm-gateway-provider] cache anchor bank eager load failed; continuing', error);
  });
  const config = await initializeConfigOnStartup();
  const registrationSettings: ProviderRegistrationSettings = {
    flagNames: resolveConfigurableLlmFlagNames(config[FLAGS_ARGUMENT]),
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
