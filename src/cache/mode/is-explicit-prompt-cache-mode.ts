import type { PromptCacheMode } from '../types';

export function isExplicitPromptCacheMode(mode: PromptCacheMode): boolean {
  return mode === 'explicit';
}
