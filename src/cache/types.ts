import type { CacheAnchorState } from './state/schema';

export type PromptCacheMode = 'explicit' | 'disabled';
export type CacheBackoffTransition = 'activated' | 'released';

export interface CachePlan {
  anchorIndexes: number[];
  // 실제 breakpoint를 찍을 앵커. 평소엔 anchorIndexes와 같고, frontier 모니터
  // 중에는 어차피 죽을 새 frontier만 빠진다 — diff 기준(anchorIndexes·상태)은
  // 유지하면서 write 프리미엄만 차단하기 위해 마킹 대상을 분리한다.
  markingAnchorIndexes: number[];
  nextState: CacheAnchorState;
}
