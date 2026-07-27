import type { LlmMessage } from 'llm-io';
import { markCacheBreakpoints } from '../../cache/breakpoint/mark-cache-breakpoints';
import { fingerprintMessage } from '../../cache/planner/fingerprint-message';
import { planCacheAnchorsFromFingerprints } from '../../cache/planner/plan-cache-anchors';
import {
  createNextCacheAnchorBankSnapshot,
  selectCacheAnchorBankState,
} from '../../cache/state/bank/select-cache-anchor-bank-state';
import type { CacheAnchorBankSnapshot } from '../../cache/state/bank/schema';

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

// provider의 storage 생명주기는 재현하지 않고 production planner 조립만 sim 계약으로 번역한다.
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
