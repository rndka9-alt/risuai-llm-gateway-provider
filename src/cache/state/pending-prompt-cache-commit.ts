import type { CacheBackoffTransition } from '../types';
import type { CacheAnchorState } from './schema';

// 소비자는 내부 상태를 해체하지 않고 commit 함수로만 전달한다. 이후 정책 상태가
// 추가되어도 cache 모듈 밖의 요청 생명주기는 바뀌지 않는다.
export const pendingPromptCacheCommitData = Symbol('pendingPromptCacheCommitData');

export interface PendingPromptCacheCommit {
  readonly [pendingPromptCacheCommitData]: {
    readonly nextState: CacheAnchorState;
    readonly transition: CacheBackoffTransition | null;
  };
}
