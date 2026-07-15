import { Llm, LlmHttpError, LLMGatewayProvider, OpenAIChatCompletionsFormat } from 'llm-io';
import {
  PROMPT_CACHE_MODE_ARGUMENT,
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

async function requestLLMGateway(
  args: ProviderArguments,
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
  const messages = toLlmMessages(args.prompt_chat);
  let requestMessages = messages;
  try {
    // disabled 모드에서도 diff 기준은 계속 갱신한다 — explicit로 되돌렸을 때
    // 스테일 diff로 잘못된 앵커가 잡히는 것을 막는다.
    const cachePlan = planCacheAnchors(await loadCacheAnchorState(), messages);
    if (isExplicitPromptCacheMode(promptCacheMode)) {
      requestMessages = markCacheBreakpoints(messages, cachePlan);
    }
    await saveCacheAnchorState(cachePlan.nextState);
  } catch (error) {
    // 앵커 처리 실패가 채팅 요청까지 죽여선 안 된다 — 이번 요청은 캐시 없이 보낸다.
    console.error(
      '[llm-gateway-provider] cache anchor handling failed; sending without breakpoints',
      error,
    );
  }

  const llm = new Llm({
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
    fetch: (url, init) => risuai.nativeFetch(url, init),
  });

  try {
    const output = await llm.generate({
      messages: requestMessages,
      options: {
        maxTokens: args.max_tokens,
        temperature: args.temperature,
        topP: args.top_p,
      },
      signal: abortSignal,
    });

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
