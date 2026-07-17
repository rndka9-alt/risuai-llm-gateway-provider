import type { LlmMessage } from 'llm-io';
import {
  fingerprintMessage,
  getPromptCacheKey,
  loadCacheAnchorState,
  markCacheBreakpoints,
  planCacheAnchors,
  saveCacheAnchorState,
  type CacheAnchorState,
  type CachePlan,
  type MessageFingerprint,
} from '../../cache';

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

function fingerprintsEqual(
  left: MessageFingerprint,
  right: MessageFingerprint,
): boolean {
  return left.role === right.role && left.hash === right.hash;
}

export function commonFingerprintPrefixLength(
  previous: readonly MessageFingerprint[],
  current: readonly MessageFingerprint[],
): number {
  const maximumLength = Math.min(previous.length, current.length);
  let length = 0;
  while (
    length < maximumLength &&
    fingerprintsEqual(previous[length], current[length])
  ) {
    length += 1;
  }
  return length;
}

function createDecision(
  plan: CachePlan,
  messages: readonly LlmMessage[],
): CachePolicyDecision {
  return {
    anchorIndexes: plan.anchorIndexes,
    consecutiveEpochResets: plan.nextState.consecutiveEpochResets,
    messages,
    promptCacheKey: getPromptCacheKey('explicit'),
  };
}

function createMarkingPlan(
  plan: CachePlan,
  previousState: CacheAnchorState | null,
  suppressNewFrontier: boolean,
): CachePlan {
  if (!suppressNewFrontier) return plan;

  const frontierIndex = plan.anchorIndexes.at(-1);
  if (
    frontierIndex === undefined ||
    previousState?.anchorIndexes.includes(frontierIndex) === true
  ) {
    return plan;
  }

  return {
    anchorIndexes: plan.anchorIndexes.filter(
      (anchorIndex) => anchorIndex !== frontierIndex,
    ),
    nextState: plan.nextState,
  };
}

interface AdaptiveTwoStrikeOptions {
  ignoreRerollLikeDeaths: boolean;
  name: 'adaptive-2strike' | 'adaptive-2strike-reroll-aware';
}

function createAdaptiveTwoStrikePolicy(
  options: AdaptiveTwoStrikeOptions,
): ReplayCachePolicy {
  let consecutiveFrontierDeaths = 0;
  let monitorFrontier = false;

  return {
    name: options.name,
    async apply(messages) {
      const previousState = await loadCacheAnchorState();
      const currentFingerprints = messages.map(fingerprintMessage);
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
          previousFrontierIndex !== undefined &&
          prefixLength <= previousFrontierIndex;
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
      const markingPlan = createMarkingPlan(
        plan,
        previousState,
        monitorFrontier,
      );
      const markedMessages = markCacheBreakpoints([...messages], markingPlan);
      await saveCacheAnchorState(plan.nextState);
      return createDecision(plan, markedMessages);
    },
  };
}

export function createProductionCachePolicy(): ReplayCachePolicy {
  return {
    name: 'production',
    async apply(messages) {
      const previousState = await loadCacheAnchorState();
      const plan = planCacheAnchors(previousState, messages);
      const markedMessages = markCacheBreakpoints([...messages], plan);
      await saveCacheAnchorState(plan.nextState);
      return createDecision(plan, markedMessages);
    },
  };
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
  return {
    name: 'first-turn-safe',
    async apply(messages) {
      const previousState = await loadCacheAnchorState();
      const currentFingerprints = messages.map(fingerprintMessage);
      const prefixLength =
        previousState === null
          ? 0
          : commonFingerprintPrefixLength(
              previousState.fingerprints,
              currentFingerprints,
            );
      const plan = planCacheAnchors(previousState, messages);
      const markedMessages =
        previousState === null || prefixLength === 0
          ? [...messages]
          : markCacheBreakpoints([...messages], plan);
      await saveCacheAnchorState(plan.nextState);
      return createDecision(plan, markedMessages);
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
