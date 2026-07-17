import type { MessageFingerprint } from '../../state/schema';
import type { CachePlan } from '../../types';
import { resolveFirstTurnFrontier } from './resolve-first-turn-frontier';

export function createFirstTurnPlan(
  fingerprints: MessageFingerprint[],
  consecutiveEpochResets = 0,
): CachePlan {
  const frontierIndex = resolveFirstTurnFrontier(fingerprints);
  const anchorIndexes = frontierIndex === null ? [] : [frontierIndex];
  return {
    anchorIndexes,
    nextState: { anchorIndexes, consecutiveEpochResets, fingerprints },
  };
}
