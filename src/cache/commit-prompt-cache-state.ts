import type { CacheBackoffTransition } from './types';
import {
  pendingPromptCacheCommitData,
  type PendingPromptCacheCommit,
} from './state/pending-prompt-cache-commit';
import { saveCacheAnchorState } from './state/save-cache-anchor-state';

export async function commitPromptCacheState(
  pendingCommit: PendingPromptCacheCommit,
): Promise<CacheBackoffTransition | null> {
  try {
    const commitData = pendingCommit[pendingPromptCacheCommitData];
    await saveCacheAnchorState(commitData.nextState);
    return commitData.transition;
  } catch (error) {
    // 캐시 상태 저장 실패로 이미 완료된 채팅 응답을 실패로 뒤집지 않는다.
    console.error('[llm-gateway-provider] cache anchor state update failed', error);
    return null;
  }
}
