import type { LlmMessage } from 'llm-io';
import { isCacheBackoffActive } from '../backoff/is-cache-backoff-active';
import type { CachePlan } from '../types';
import { markBreakpoint } from './utils/mark-breakpoint';
import { passesMinimumPrefixTokens } from './utils/passes-minimum-prefix-tokens';
import { toMarkableIndex } from './utils/to-markable-index';

export function markCacheBreakpoints(
  messages: LlmMessage[],
  plan: CachePlan,
  consecutiveBankMisses = 0,
): LlmMessage[] {
  if (isCacheBackoffActive(consecutiveBankMisses)) {
    // 연속 bank miss 중에는 쓰기 프리미엄 손실을 실시간 차단하되, 새 상태는
    // 계속 저장해 안정 프리픽스가 돌아온 즉시 자동 복구한다.
    return messages;
  }

  const markableIndexes = new Set<number>();
  for (const anchorIndex of plan.markingAnchorIndexes) {
    const markableIndex = toMarkableIndex(messages, anchorIndex);
    if (
      markableIndex !== null &&
      passesMinimumPrefixTokens(plan.nextState.fingerprints, markableIndex)
    ) {
      markableIndexes.add(markableIndex);
    }
  }

  if (markableIndexes.size === 0) return messages;

  return messages.map((message, index) =>
    markableIndexes.has(index) ? markBreakpoint(message) : message,
  );
}
