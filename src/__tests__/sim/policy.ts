import type { LlmMessage } from 'llm-io';
import {
  FRONTIER_DEATH_MONITOR_THRESHOLD,
  MAX_NEW_CACHE_WRITE_TOKENS,
} from '../../cache/constants';
import { sumTextTokenEstimatesBetween } from '../../cache/planner/utils/sum-token-estimates-between';
import type { AnchorAdmission } from '../../cache/state/schema';
import { commitPromptCacheState, preparePromptCacheRequest } from '../../cache';
import { markCacheBreakpoints } from '../../cache/breakpoint/mark-cache-breakpoints';
import { getPromptCacheKey } from '../../cache/mode/get-prompt-cache-key';
import { fingerprintMessage } from '../../cache/planner/fingerprint-message';
import { planCacheAnchors } from '../../cache/planner/plan-cache-anchors';
import { loadCacheAnchorState } from '../../cache/state/load-cache-anchor-state';
import { saveCacheAnchorState } from '../../cache/state/save-cache-anchor-state';
import type { CacheAnchorState, MessageFingerprint } from '../../cache/state/schema';
import type { CachePlan } from '../../cache/types';

export interface CachePolicyDecision {
  anchorIndexes: readonly number[];
  consecutiveEpochResets: number;
  messages: readonly LlmMessage[];
  promptCacheKey: string;
}

// 새 정책은 이 인터페이스만 구현하면 동일 trajectory와 gateway kernel을 재사용한다.
export interface ReplayCachePolicy {
  readonly name: string;
  apply(messages: readonly LlmMessage[]): Promise<CachePolicyDecision>;
}

function fingerprintsEqual(left: MessageFingerprint, right: MessageFingerprint): boolean {
  return left.role === right.role && left.hash === right.hash;
}

export function commonFingerprintPrefixLength(
  previous: readonly MessageFingerprint[],
  current: readonly MessageFingerprint[],
): number {
  const maximumLength = Math.min(previous.length, current.length);
  let length = 0;
  while (length < maximumLength && fingerprintsEqual(previous[length], current[length])) {
    length += 1;
  }
  return length;
}

function createDecision(
  plan: CachePlan,
  messages: readonly LlmMessage[],
  consecutiveEpochResets: number,
): CachePolicyDecision {
  return {
    anchorIndexes: plan.anchorIndexes,
    consecutiveEpochResets,
    messages,
    promptCacheKey: getPromptCacheKey('explicit'),
  };
}

function createLegacyEpochResetTracker(): {
  update(
    previousState: CacheAnchorState | null,
    currentFingerprints: readonly MessageFingerprint[],
  ): number;
} {
  let consecutiveEpochResets = 0;
  return {
    update(previousState, currentFingerprints) {
      if (previousState === null || previousState.fingerprints.length === 0) {
        consecutiveEpochResets = 0;
      } else {
        const prefixLength = commonFingerprintPrefixLength(
          previousState.fingerprints,
          currentFingerprints,
        );
        consecutiveEpochResets = prefixLength === 0 ? consecutiveEpochResets + 1 : 0;
      }
      return consecutiveEpochResets;
    },
  };
}

function createLegacyProductionPlan(plan: CachePlan): CachePlan {
  return {
    ...plan,
    markingAnchorIndexes:
      plan.nextState.consecutiveFrontierDeaths >= FRONTIER_DEATH_MONITOR_THRESHOLD
        ? plan.anchorIndexes.slice(0, -1)
        : plan.anchorIndexes,
  };
}

function createTwoSurvivalProductionPlan(
  previousState: CacheAnchorState | null,
  plan: CachePlan,
): CachePlan {
  const previousAdmissions = new Map(
    (previousState === null ? [] : previousState.anchorAdmissions).map((admission) => [
      admission.anchorIndex,
      admission,
    ]),
  );
  const anchorAdmissions = plan.nextState.anchorAdmissions.map((admission) => {
    if (!admission.requiresValidation || !admission.admitted) return admission;
    const previousAdmission = previousAdmissions.get(admission.anchorIndex);
    if (previousAdmission === undefined) {
      throw new Error('Admitted validation candidate must exist in the previous state.');
    }
    if (previousAdmission.admitted || previousAdmission.consecutiveSurvivals >= 1) {
      return admission;
    }
    return { ...admission, admitted: false, consecutiveSurvivals: 1 };
  });
  const latestAnchorIndex = plan.anchorIndexes.at(-1);
  return {
    ...plan,
    markingAnchorIndexes: anchorAdmissions
      .filter(
        (admission) =>
          (!admission.requiresValidation || admission.admitted) &&
          !(
            plan.nextState.consecutiveFrontierDeaths >= FRONTIER_DEATH_MONITOR_THRESHOLD &&
            admission.anchorIndex === latestAnchorIndex
          ),
      )
      .map((admission) => admission.anchorIndex),
    // 실제 production 승격 전의 두 번 생존 정책을 비교 대상으로 보존한다.
    nextState: { ...plan.nextState, anchorAdmissions },
  };
}

function resolveHistoricalHardCappedAdmissions(
  previousState: CacheAnchorState | null,
  plan: CachePlan,
): AnchorAdmission[] {
  const previousAdmissions = new Map(
    (previousState === null ? [] : previousState.anchorAdmissions).map((admission) => [
      admission.anchorIndex,
      admission,
    ]),
  );
  const deepestExistingAdmissionIndex = plan.nextState.anchorAdmissions.reduce(
    (deepestIndex, admission) => {
      const previousAdmission = previousAdmissions.get(admission.anchorIndex);
      return admission.admitted && previousAdmission?.admitted === true
        ? Math.max(deepestIndex, admission.anchorIndex)
        : deepestIndex;
    },
    -1,
  );

  return plan.nextState.anchorAdmissions.map((admission) => {
    const previousAdmission = previousAdmissions.get(admission.anchorIndex);
    if (!admission.admitted || previousAdmission?.admitted === true) return admission;

    const estimatedNewWriteTokens =
      admission.anchorIndex <= deepestExistingAdmissionIndex
        ? 0
        : sumTextTokenEstimatesBetween(
            plan.nextState.fingerprints,
            deepestExistingAdmissionIndex,
            admission.anchorIndex,
          );
    return estimatedNewWriteTokens <= MAX_NEW_CACHE_WRITE_TOKENS
      ? admission
      : { ...admission, admitted: false };
  });
}

function createHistoricalHardCappedPlan(
  previousState: CacheAnchorState | null,
  plan: CachePlan,
  validateEveryCandidate: boolean,
): CachePlan {
  const anchorAdmissions = resolveHistoricalHardCappedAdmissions(previousState, plan);
  const latestAnchorIndex = plan.anchorIndexes.at(-1);
  return {
    ...plan,
    markingAnchorIndexes: anchorAdmissions
      .filter(
        (admission) =>
          (validateEveryCandidate
            ? admission.admitted
            : !admission.requiresValidation || admission.admitted) &&
          !(
            plan.nextState.consecutiveFrontierDeaths >= FRONTIER_DEATH_MONITOR_THRESHOLD &&
            admission.anchorIndex === latestAnchorIndex
          ),
      )
      .map((admission) => admission.anchorIndex),
    nextState: { ...plan.nextState, anchorAdmissions },
  };
}

function createHistoricalHardCappedPolicy(options: {
  name: 'selective-hard-cap' | 'validated-all';
  validateEveryCandidate: boolean;
}): ReplayCachePolicy {
  const epochResetTracker = createLegacyEpochResetTracker();
  return {
    name: options.name,
    async apply(messages) {
      const previousState = await loadCacheAnchorState();
      const consecutiveEpochResets = epochResetTracker.update(
        previousState,
        messages.map(fingerprintMessage),
      );
      const plan = planCacheAnchors(previousState, messages);
      const historicalPlan = createHistoricalHardCappedPlan(
        previousState,
        plan,
        options.validateEveryCandidate,
      );
      const markedMessages = markCacheBreakpoints(
        [...messages],
        historicalPlan,
        consecutiveEpochResets,
      );
      await saveCacheAnchorState(historicalPlan.nextState);
      return createDecision(historicalPlan, markedMessages, consecutiveEpochResets);
    },
  };
}

function createMarkingPlan(
  plan: CachePlan,
  previousState: CacheAnchorState | null,
  currentFingerprints: readonly MessageFingerprint[],
  suppressNewFrontier: boolean,
): CachePlan {
  if (!suppressNewFrontier) return plan;

  const frontierIndex = plan.anchorIndexes.at(-1);
  if (frontierIndex === undefined) return plan;

  if (previousState !== null && previousState.anchorIndexes.includes(frontierIndex)) {
    const previousFingerprint = previousState.fingerprints[frontierIndex];
    const currentFingerprint = currentFingerprints[frontierIndex];
    if (previousFingerprint === undefined || currentFingerprint === undefined) {
      throw new RangeError('Frontier index must reference both fingerprint sets.');
    }
    if (previousFingerprint.hash === currentFingerprint.hash) return plan;
  }

  return {
    anchorIndexes: plan.anchorIndexes.filter((anchorIndex) => anchorIndex !== frontierIndex),
    markingAnchorIndexes: plan.markingAnchorIndexes.filter(
      (anchorIndex) => anchorIndex !== frontierIndex,
    ),
    nextState: plan.nextState,
  };
}

interface AdaptiveTwoStrikeOptions {
  ignoreRerollLikeDeaths: boolean;
  name: 'adaptive-2strike' | 'adaptive-2strike-reroll-aware';
}

function createAdaptiveTwoStrikePolicy(options: AdaptiveTwoStrikeOptions): ReplayCachePolicy {
  let consecutiveFrontierDeaths = 0;
  let monitorFrontier = false;
  const epochResetTracker = createLegacyEpochResetTracker();

  return {
    name: options.name,
    async apply(messages) {
      const previousState = await loadCacheAnchorState();
      const currentFingerprints = messages.map(fingerprintMessage);
      const consecutiveEpochResets = epochResetTracker.update(previousState, currentFingerprints);
      let prefixLength = 0;

      if (previousState === null) {
        consecutiveFrontierDeaths = 0;
        monitorFrontier = false;
      } else {
        prefixLength = commonFingerprintPrefixLength(
          previousState.fingerprints,
          currentFingerprints,
        );
        const previousFrontierIndex = previousState.anchorIndexes.at(-1);
        const frontierDied =
          previousFrontierIndex !== undefined && prefixLength <= previousFrontierIndex;
        const rerollLikeChange =
          previousState.fingerprints.length === currentFingerprints.length &&
          prefixLength < currentFingerprints.length;

        if (!(options.ignoreRerollLikeDeaths && rerollLikeChange)) {
          if (frontierDied) {
            consecutiveFrontierDeaths += 1;
            if (consecutiveFrontierDeaths >= 2) monitorFrontier = true;
          } else {
            consecutiveFrontierDeaths = 0;
            monitorFrontier = false;
          }
        }
      }

      const plan = planCacheAnchors(previousState, messages);
      const legacyPlan = createLegacyProductionPlan(plan);
      const markingPlan = createMarkingPlan(
        legacyPlan,
        previousState,
        currentFingerprints,
        monitorFrontier,
      );
      const markedMessages = markCacheBreakpoints(
        [...messages],
        markingPlan,
        consecutiveEpochResets,
      );
      await saveCacheAnchorState(plan.nextState);
      return createDecision(plan, markedMessages, consecutiveEpochResets);
    },
  };
}

export function createProductionCachePolicy(): ReplayCachePolicy {
  return {
    name: 'production',
    async apply(messages) {
      const prepared = await preparePromptCacheRequest([...messages], 'explicit');
      if (prepared.pendingCommit === null) {
        throw new Error('Production cache policy must prepare a bank commit.');
      }
      await commitPromptCacheState(prepared.pendingCommit);
      return {
        anchorIndexes: [],
        consecutiveEpochResets: 0,
        messages: prepared.requestMessages,
        promptCacheKey: getPromptCacheKey('explicit'),
      };
    },
  };
}

export function createTwoSurvivalProductionCachePolicy(): ReplayCachePolicy {
  const epochResetTracker = createLegacyEpochResetTracker();
  return {
    name: 'production-two-survival',
    async apply(messages) {
      const previousState = await loadCacheAnchorState();
      const consecutiveEpochResets = epochResetTracker.update(
        previousState,
        messages.map(fingerprintMessage),
      );
      const plan = createTwoSurvivalProductionPlan(
        previousState,
        planCacheAnchors(previousState, messages),
      );
      const markedMessages = markCacheBreakpoints([...messages], plan, consecutiveEpochResets);
      await saveCacheAnchorState(plan.nextState);
      return createDecision(plan, markedMessages, consecutiveEpochResets);
    },
  };
}

export function createLegacyProductionCachePolicy(): ReplayCachePolicy {
  const epochResetTracker = createLegacyEpochResetTracker();
  return {
    name: 'legacy-production',
    async apply(messages) {
      const previousState = await loadCacheAnchorState();
      const consecutiveEpochResets = epochResetTracker.update(
        previousState,
        messages.map(fingerprintMessage),
      );
      const plan = planCacheAnchors(previousState, messages);
      const legacyPlan = createLegacyProductionPlan(plan);
      const markedMessages = markCacheBreakpoints(
        [...messages],
        legacyPlan,
        consecutiveEpochResets,
      );
      await saveCacheAnchorState(plan.nextState);
      return createDecision(plan, markedMessages, consecutiveEpochResets);
    },
  };
}

export function createValidatedAllCachePolicy(): ReplayCachePolicy {
  return createHistoricalHardCappedPolicy({
    name: 'validated-all',
    validateEveryCandidate: true,
  });
}

export function createSelectiveHardCapCachePolicy(): ReplayCachePolicy {
  return createHistoricalHardCappedPolicy({
    name: 'selective-hard-cap',
    validateEveryCandidate: false,
  });
}

export function createAdaptiveTwoStrikeCachePolicy(): ReplayCachePolicy {
  return createAdaptiveTwoStrikePolicy({
    ignoreRerollLikeDeaths: false,
    name: 'adaptive-2strike',
  });
}

export function createAdaptiveTwoStrikeRerollAwareCachePolicy(): ReplayCachePolicy {
  return createAdaptiveTwoStrikePolicy({
    ignoreRerollLikeDeaths: true,
    name: 'adaptive-2strike-reroll-aware',
  });
}

export function createFirstTurnSafeCachePolicy(): ReplayCachePolicy {
  const epochResetTracker = createLegacyEpochResetTracker();
  return {
    name: 'first-turn-safe',
    async apply(messages) {
      const previousState = await loadCacheAnchorState();
      const currentFingerprints = messages.map(fingerprintMessage);
      const consecutiveEpochResets = epochResetTracker.update(previousState, currentFingerprints);
      const prefixLength =
        previousState === null
          ? 0
          : commonFingerprintPrefixLength(previousState.fingerprints, currentFingerprints);
      const plan = planCacheAnchors(previousState, messages);
      const legacyPlan = createLegacyProductionPlan(plan);
      const markedMessages =
        previousState === null || prefixLength === 0
          ? [...messages]
          : markCacheBreakpoints([...messages], legacyPlan, consecutiveEpochResets);
      await saveCacheAnchorState(plan.nextState);
      return createDecision(plan, markedMessages, consecutiveEpochResets);
    },
  };
}

export function createNoCachePolicy(): ReplayCachePolicy {
  return {
    name: 'no-cache',
    async apply(messages) {
      return {
        anchorIndexes: [],
        consecutiveEpochResets: 0,
        messages: [...messages],
        promptCacheKey: getPromptCacheKey('disabled'),
      };
    },
  };
}
