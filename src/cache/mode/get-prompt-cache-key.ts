import {
  DISABLED_PROMPT_CACHE_KEY,
  EXPLICIT_PROMPT_CACHE_KEY,
} from '../constants';
import type { PromptCacheMode } from '../types';
import { isExplicitPromptCacheMode } from './is-explicit-prompt-cache-mode';

export function getPromptCacheKey(mode: PromptCacheMode): string {
  return isExplicitPromptCacheMode(mode) ? EXPLICIT_PROMPT_CACHE_KEY : DISABLED_PROMPT_CACHE_KEY;
}
