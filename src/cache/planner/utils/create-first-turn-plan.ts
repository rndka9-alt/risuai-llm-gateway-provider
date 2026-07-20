import type { MessageFingerprint } from '../../state/schema';
import type { CachePlan } from '../../types';
import { MAX_NEW_CACHE_WRITE_TOKENS } from '../../constants';
import { resolveFirstTurnFrontier } from './resolve-first-turn-frontier';
import { sumTextTokenEstimatesBetween } from './sum-token-estimates-between';

export function createFirstTurnPlan(
  fingerprints: MessageFingerprint[],
  consecutiveEpochResets = 0,
): CachePlan {
  const frontierIndex = resolveFirstTurnFrontier(fingerprints);
  const anchorIndexes = frontierIndex === null ? [] : [frontierIndex];
  const anchorAdmissions = anchorIndexes.map((anchorIndex) => ({
    admitted: false,
    anchorIndex,
    consecutiveSurvivals: 0,
    requiresValidation:
      sumTextTokenEstimatesBetween(fingerprints, -1, anchorIndex) > MAX_NEW_CACHE_WRITE_TOKENS,
  }));
  return {
    anchorIndexes,
    markingAnchorIndexes: anchorAdmissions
      .filter((admission) => !admission.requiresValidation)
      .map((admission) => admission.anchorIndex),
    // 새 epoch은 frontier 사망 이력도 새로 시작한다 — 방 전환(prefix 0)이
    // epoch 백오프와 frontier 모니터에 이중 계상되는 것을 막는다.
    nextState: {
      anchorAdmissions,
      anchorIndexes,
      consecutiveEpochResets,
      consecutiveFrontierDeaths: 0,
      fingerprints,
    },
  };
}
