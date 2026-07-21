import type { CacheAnchorState } from './state/schema';

export type PromptCacheMode = 'explicit' | 'disabled';
export type CacheBackoffTransition = 'activated' | 'released';

export interface CachePlan {
  anchorIndexes: number[];
  // 실제 breakpoint를 찍을 앵커. 안전 후보는 즉시 포함하고, 구조적
  // frontier 사망·대규모 write 후보는 admission된 뒤 포함한다. 모니터
  // 중에는 latest frontier를 한 번 더 걸러 어차피 죽을 write를 차단한다.
  markingAnchorIndexes: number[];
  // 구형 sim 정책의 로그 호환 필드일 뿐 영속 bank state에는 저장하지 않는다.
  // 실제 백오프 소스는 bank index의 consecutiveBankMisses다.
  nextState: CacheAnchorState & { readonly consecutiveEpochResets: number };
}
