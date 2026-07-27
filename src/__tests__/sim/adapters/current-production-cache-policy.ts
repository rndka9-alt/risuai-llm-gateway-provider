import type { LlmMessage } from 'llm-io';
import type { ReplayCachePolicy } from 'llm-cache-simulator';
import { markCacheBreakpoints } from '../../../cache/breakpoint/mark-cache-breakpoints';
import { getPromptCacheKey } from '../../../cache/mode/get-prompt-cache-key';
import { fingerprintMessage } from '../../../cache/planner/fingerprint-message';
import { planCacheAnchorsFromFingerprints } from '../../../cache/planner/plan-cache-anchors';
import type { CacheAnchorBankSnapshot } from '../../../cache/state/bank/schema';
import {
  createNextCacheAnchorBankSnapshot,
  selectCacheAnchorBankState,
} from '../../../cache/state/bank/select-cache-anchor-bank-state';

export interface ProductionCacheTransition {
  readonly nextSnapshot: CacheAnchorBankSnapshot;
  readonly requestMessages: readonly LlmMessage[];
}

export function createEmptyProductionCacheSnapshot(): CacheAnchorBankSnapshot {
  return {
    consecutiveBankMisses: 0,
    lruSlots: [],
    statesBySlot: new Map(),
    unpersistedSlots: new Set(),
  };
}

// package의 고정 preset과 별개로 provider HEAD의 planner 조립을 회귀 검증한다.
export function createProductionCacheTransition(options: {
  messages: readonly LlmMessage[];
  previousSnapshot: CacheAnchorBankSnapshot;
}): ProductionCacheTransition {
  const { messages, previousSnapshot } = options;
  const fingerprints = messages.map(fingerprintMessage);
  const selection = selectCacheAnchorBankState(previousSnapshot, fingerprints);
  const plan = planCacheAnchorsFromFingerprints(selection.previousState, fingerprints);
  const nextSnapshot = createNextCacheAnchorBankSnapshot(
    previousSnapshot,
    selection,
    plan.nextState,
  );

  return {
    nextSnapshot,
    requestMessages: markCacheBreakpoints([...messages], plan, nextSnapshot.consecutiveBankMisses),
  };
}

export function createProductionCachePolicy(): ReplayCachePolicy {
  let snapshot = createEmptyProductionCacheSnapshot();

  return {
    name: 'production',
    async apply(messages: readonly LlmMessage[]) {
      const transition = createProductionCacheTransition({
        messages,
        previousSnapshot: snapshot,
      });
      snapshot = transition.nextSnapshot;
      return {
        anchorIndexes: [],
        consecutiveEpochResets: 0,
        messages: transition.requestMessages,
        promptCacheKey: getPromptCacheKey('explicit'),
      };
    },
  };
}
