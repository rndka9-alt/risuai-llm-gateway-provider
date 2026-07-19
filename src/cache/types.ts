import type { CacheAnchorState } from './state/schema';

export type PromptCacheMode = 'explicit' | 'disabled';
export type CacheBackoffTransition = 'activated' | 'released';

export interface CachePlan {
  anchorIndexes: number[];
  // 실제 breakpoint를 찍을 앵커. 안전 후보는 즉시 포함하고, 구조적
  // frontier 사망·대규모 write 후보는 admission된 뒤 포함한다. 모니터
  // 중에는 latest frontier를 한 번 더 걸러 어차피 죽을 write를 차단한다.
  markingAnchorIndexes: number[];
  nextState: CacheAnchorState;
}
