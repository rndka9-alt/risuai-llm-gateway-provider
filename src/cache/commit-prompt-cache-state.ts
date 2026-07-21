import type { CacheBackoffTransition } from './types';
import {
  pendingPromptCacheCommitData,
  type PendingPromptCacheCommit,
} from './state/pending-prompt-cache-commit';
import { saveCacheAnchorBankUpdate } from './state/bank/cache-anchor-bank-store';

export async function commitPromptCacheState(
  pendingCommit: PendingPromptCacheCommit,
): Promise<CacheBackoffTransition | null> {
  try {
    const commitData = pendingCommit[pendingPromptCacheCommitData];
    if (commitData.updatedSlot !== null) {
      await saveCacheAnchorBankUpdate(commitData.updatedSlot, commitData.nextSnapshot);
    }
    return commitData.transition;
  } catch (error) {
    // 캐시 상태 저장 실패로 이미 완료된 채팅 응답을 실패로 뒤집지 않는다.
    console.error('[llm-gateway-provider] cache anchor state update failed', error);
    return null;
  }
}
