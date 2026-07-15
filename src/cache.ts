import type { LlmMessage, OpenAIChatCompletionsExtraBody } from 'llm-io';

export const PROMPT_CACHE_MODE_ARGUMENT = 'prompt_cache_mode';
export const EXPLICIT_PROMPT_CACHE_KEY = 'risuai:llm-gateway-provider:v1';
export const DISABLED_PROMPT_CACHE_KEY = 'risuai:llm-gateway-provider:v1:disabled';

export type PromptCacheMode = 'explicit' | 'disabled';

export function resolvePromptCacheMode(value: string | undefined): PromptCacheMode {
  return value?.trim() === 'explicit' ? 'explicit' : 'disabled';
}

export function isExplicitPromptCacheMode(mode: PromptCacheMode): boolean {
  return mode === 'explicit';
}

export function getPromptCacheKey(mode: PromptCacheMode): string {
  return isExplicitPromptCacheMode(mode) ? EXPLICIT_PROMPT_CACHE_KEY : DISABLED_PROMPT_CACHE_KEY;
}

export function createPromptCacheExtraBody(
  mode: PromptCacheMode,
): OpenAIChatCompletionsExtraBody {
  return {
    prompt_cache_key: getPromptCacheKey(mode),
    prompt_cache_options: { mode: 'explicit' },
  };
}

export function applyCacheBreakpoints(messages: LlmMessage[]): LlmMessage[] {
  // 실제 breakpoint 배치 정책은 추후 구현하므로, 지금은 호출 경계만 고정하고 원본 배열을 그대로 반환한다.
  return messages;
}
