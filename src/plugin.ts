import {
  Llm,
  LlmHttpError,
  LLMGatewayProvider,
  OpenAIChatCompletionsFormat,
  type LlmMessage,
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
import { SERVICE_TIER_ARGUMENT, resolveServiceTier } from './options';
import { openSettings } from './settings';

declare const __VERSION__: string;

const PROVIDER_NAME = 'LLM Gateway';

// 실제 오류 문구가 충분히 쌓이면 조건을 좁힐 수 있도록 감지 문자열을 한곳에 둔다.
const PROMPT_CACHE_ERROR_HINT = 'prompt_cache';
const CACHE_ERROR_HINT = 'cache';
const BREAKPOINT_ERROR_HINT = 'breakpoint';

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

async function requestLLMGateway(
  providerArguments: ProviderArguments,
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
    // 실패한 요청이 다음 diff의 기준을 오염시키지 않도록 성공 뒤에만 저장한다.
    nextCacheAnchorState = cachePlan.nextState;
  } catch (error) {
    // 앵커 처리 실패가 채팅 요청까지 죽여선 안 된다 — 이번 요청은 캐시 없이 보낸다.
    console.error(
      '[llm-gateway-provider] cache anchor handling failed; sending without breakpoints',
      error,
    );
  }

  const gatewayClient = new Llm({
    format: new OpenAIChatCompletionsFormat({
      model,
      extraBody: {
        ...createPromptCacheExtraBody(promptCacheMode),
        ...(serviceTier === undefined ? {} : { service_tier: serviceTier }),
      },
    }),
    provider: new LLMGatewayProvider(baseUrl === undefined ? { apiKey } : { apiKey, baseUrl }),
    // 플러그인 iframe은 CSP(connect-src 'none')로 직접 fetch가 막혀 있어
    // RisuAI 브릿지를 경유한다.
    fetch: (url, requestInit) => risuai.nativeFetch(url, requestInit),
  });

  try {
    const requestOptions = {
      maxTokens: providerArguments.max_tokens,
      temperature: providerArguments.temperature,
      topP: providerArguments.top_p,
    };
    let output;
    try {
      output = await gatewayClient.generate({
        messages: requestMessages,
        options: requestOptions,
        signal: abortSignal,
      });
    } catch (error) {
      if (!shouldRetryWithoutCacheBreakpoints(error, containsCacheBreakpoint(requestMessages))) {
        throw error;
      }
      console.warn(
        '[llm-gateway-provider] cache breakpoint rejected; retrying once without breakpoints',
      );
      output = await gatewayClient.generate({
        messages,
        options: requestOptions,
        signal: abortSignal,
      });
    }

    if (nextCacheAnchorState !== null) {
      try {
        // 원장 갱신과 같은 성공 시점에 모아 저장소 동기화 횟수를 줄인다.
        await saveCacheAnchorState(nextCacheAnchorState);
      } catch (error) {
        console.error('[llm-gateway-provider] cache anchor state update failed', error);
      }
    }

    try {
      await accumulateCacheUsage(output.usage, output.raw, model);
    } catch (error) {
      // 손익 집계 실패로 응답 전달을 막지 않는다.
      console.error('[llm-gateway-provider] cache ledger update failed', error);
    }

    return { success: true, content: output.message.text };
  } catch (error) {
    return { success: false, content: toFailureContent(error) };
  }
}

async function main(): Promise<void> {
  await risuai.addProvider(PROVIDER_NAME, requestLLMGateway);
  const settingsRegistration = await risuai.registerSetting(
    'LLM Gateway',
    openSettings,
    '&#x1f511;',
    'html',
    'llm-gateway-settings',
  );
  await risuai.onUnload(() => risuai.unregisterUIPart(settingsRegistration.id));
  console.log(`[llm-gateway-provider] v${__VERSION__} loaded`);
}

void main();
