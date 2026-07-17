import type { OpenAIChatCompletionsExtraBody } from 'llm-io';
import type { PromptCacheMode } from '../types';
import { getPromptCacheKey } from './get-prompt-cache-key';

export function createPromptCacheExtraBody(
  mode: PromptCacheMode,
): OpenAIChatCompletionsExtraBody {
  return {
    prompt_cache_key: getPromptCacheKey(mode),
    prompt_cache_options: {
      mode: 'explicit',
      // 현재 지원되는 유일한 값이자 기본값이지만, 정책이 요청에 드러나도록 명시한다.
      ttl: '30m',
    },
  };
}
