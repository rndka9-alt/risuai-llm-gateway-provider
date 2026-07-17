import type { CacheAnchorState } from './state/schema';

export type PromptCacheMode = 'explicit' | 'disabled';
export type CacheBackoffTransition = 'activated' | 'released';

export interface CachePlan {
  anchorIndexes: number[];
  nextState: CacheAnchorState;
}
