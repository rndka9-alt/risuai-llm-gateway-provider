import type { OpenAIChatCompletionsExtraBody } from 'llm-io';
import type { PromptCacheMode } from '../types';
import { getFallbackPromptCacheKey, getPromptCacheKey } from './get-prompt-cache-key';

function createExtraBody(promptCacheKey: string): OpenAIChatCompletionsExtraBody {
  return {
    prompt_cache_key: promptCacheKey,
    prompt_cache_options: {
      mode: 'explicit',
      // 현재 지원되는 유일한 값이자 기본값이지만, 정책이 요청에 드러나도록 명시한다.
      ttl: '30m',
    },
  };
}

export async function createPromptCacheExtraBody(
  mode: PromptCacheMode,
): Promise<OpenAIChatCompletionsExtraBody> {
  return createExtraBody(await getPromptCacheKey(mode));
}

// 캐시 실패 폴백 경로 전용 — storage에 닿지 않아 다시 실패할 수 없다.
export function createFallbackPromptCacheExtraBody(
  mode: PromptCacheMode,
): OpenAIChatCompletionsExtraBody {
  return createExtraBody(getFallbackPromptCacheKey(mode));
}
