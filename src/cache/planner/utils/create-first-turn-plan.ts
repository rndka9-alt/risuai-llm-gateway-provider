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
    markingAnchorIndexes: anchorIndexes,
    // 새 epoch은 frontier 사망 이력도 새로 시작한다 — 방 전환(prefix 0)이
    // epoch 백오프와 frontier 모니터에 이중 계상되는 것을 막는다.
    nextState: { anchorIndexes, consecutiveEpochResets, consecutiveFrontierDeaths: 0, fingerprints },
  };
}
