import type { LlmUsage } from 'llm-io';
import { commitPromptCacheState, type PendingPromptCacheCommit } from '../cache';
import { accumulateCacheUsage } from '../ledger';
import { showCacheBackoffToast } from '../toast';

export async function completeSuccessfulRequest(
  pendingPromptCacheCommit: PendingPromptCacheCommit | null,
  usage: LlmUsage | undefined,
  rawResponse: unknown,
  model: string,
  requestedServiceTier: string | undefined,
): Promise<void> {
  if (pendingPromptCacheCommit !== null) {
    // 실패 응답이나 미완료 스트림이 다음 diff의 기준을 오염시키지 않도록 완료 뒤에만 저장한다.
    const cacheBackoffTransition = await commitPromptCacheState(pendingPromptCacheCommit);
    if (cacheBackoffTransition !== null) {
      await showCacheBackoffToast(cacheBackoffTransition);
    }
  }

  try {
    await accumulateCacheUsage(usage, rawResponse, model, requestedServiceTier);
  } catch (error) {
    // 손익 집계 실패로 응답 전달을 막지 않는다.
    console.error('[llm-gateway-provider] cache ledger update failed', error);
  }
}
