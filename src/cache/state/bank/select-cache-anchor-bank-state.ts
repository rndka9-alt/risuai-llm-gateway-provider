import { BANK_MAX_STATES, MIN_CACHEABLE_PREFIX_TOKENS } from '../../constants';
import { isCacheBackoffActive } from '../../backoff/is-cache-backoff-active';
import { shouldForkCacheAnchorState } from '../../planner/utils/should-fork-cache-anchor-state';
import { commonPrefixLength } from '../../planner/utils/common-prefix-length';
import { sumTokenEstimatesBetween } from '../../planner/utils/sum-token-estimates-between';
import type { CacheAnchorState, MessageFingerprint } from '../schema';
import type { CacheAnchorBankSnapshot } from './schema';

export interface CacheAnchorBankSelection {
  readonly consecutiveBankMisses: number;
  readonly lruSlots: readonly number[];
  readonly previousState: CacheAnchorState | null;
  readonly slot: number | null;
}

export function selectCacheAnchorBankState(
  snapshot: CacheAnchorBankSnapshot,
  fingerprints: readonly MessageFingerprint[],
): CacheAnchorBankSelection {
  let matchedSlot: number | null = null;
  let longestPrefixLength = 0;
  const totalTokens = sumTokenEstimatesBetween(fingerprints, -1, fingerprints.length - 1);
  const isSubMinimumCacheableRequest = totalTokens < MIN_CACHEABLE_PREFIX_TOKENS;

  // MRU → LRU 순회에서 더 긴 매치만 교체하므로 동률은 최근 슬롯이 이긴다.
  for (const slot of snapshot.lruSlots) {
    const state = snapshot.statesBySlot.get(slot);
    if (state === undefined) {
      throw new RangeError('Cache anchor bank LRU slot must reference a loaded state.');
    }
    const prefixLength = commonPrefixLength(state.fingerprints, fingerprints);
    const prefixTokens = sumTokenEstimatesBetween(fingerprints, -1, prefixLength - 1);
    if (!isSubMinimumCacheableRequest && prefixTokens < MIN_CACHEABLE_PREFIX_TOKENS) continue;
    if (prefixLength <= longestPrefixLength) continue;
    matchedSlot = slot;
    longestPrefixLength = prefixLength;
  }

  if (matchedSlot !== null && longestPrefixLength >= 1) {
    const previousState = snapshot.statesBySlot.get(matchedSlot);
    if (previousState === undefined) {
      throw new RangeError('Selected cache anchor bank slot must reference a state.');
    }
    if (shouldForkCacheAnchorState(previousState, fingerprints, longestPrefixLength)) {
      const forkSlot = resolveForkSlot(snapshot, matchedSlot);
      return {
        consecutiveBankMisses: 0,
        lruSlots: [forkSlot, ...snapshot.lruSlots.filter((slot) => slot !== forkSlot)],
        previousState: createForkSeedState(previousState, longestPrefixLength),
        slot: forkSlot,
      };
    }

    return createMatchedSelection(snapshot, matchedSlot, previousState);
  }

  const slot = resolveMissSlot(snapshot, isSubMinimumCacheableRequest);
  if (slot === null) {
    return {
      consecutiveBankMisses: snapshot.consecutiveBankMisses,
      lruSlots: snapshot.lruSlots,
      previousState: null,
      slot: null,
    };
  }
  return {
    // 캐시될 수 없는 소형 요청은 churn 증거가 아니므로 백오프 miss로 세지 않는다.
    consecutiveBankMisses: isSubMinimumCacheableRequest
      ? snapshot.consecutiveBankMisses
      : snapshot.consecutiveBankMisses + 1,
    lruSlots: [slot, ...snapshot.lruSlots.filter((candidate) => candidate !== slot)],
    previousState: null,
    slot,
  };
}

export function createNextCacheAnchorBankSnapshot(
  snapshot: CacheAnchorBankSnapshot,
  selection: CacheAnchorBankSelection,
  nextState: CacheAnchorState,
): CacheAnchorBankSnapshot {
  if (selection.slot === null) return snapshot;

  const statesBySlot = new Map(snapshot.statesBySlot);
  statesBySlot.set(selection.slot, nextState);
  return {
    consecutiveBankMisses: selection.consecutiveBankMisses,
    lruSlots: selection.lruSlots,
    statesBySlot,
    unpersistedSlots: snapshot.unpersistedSlots,
  };
}

function resolveMissSlot(
  snapshot: CacheAnchorBankSnapshot,
  isSubMinimumCacheableRequest: boolean,
): number | null {
  if (isCacheBackoffActive(snapshot.consecutiveBankMisses)) {
    const previousMissSlot = snapshot.lruSlots[0];
    if (previousMissSlot !== undefined) return previousMissSlot;
  }

  // 캐시될 수 없는 소형 요청은 만석 bank의 실그룹을 밀어내면서까지 상태를
  // 보존할 가치가 없다. 빈 슬롯이 있을 때만 연속성 상태를 남긴다.
  if (isSubMinimumCacheableRequest && snapshot.statesBySlot.size >= BANK_MAX_STATES) return null;

  return resolveNewSlot(snapshot, null);
}

function resolveForkSlot(snapshot: CacheAnchorBankSnapshot, sourceSlot: number): number {
  return resolveNewSlot(snapshot, sourceSlot);
}

function resolveNewSlot(snapshot: CacheAnchorBankSnapshot, protectedSlot: number | null): number {
  if (snapshot.statesBySlot.size < BANK_MAX_STATES) {
    for (let slot = 0; slot < BANK_MAX_STATES; slot += 1) {
      if (!snapshot.statesBySlot.has(slot)) return slot;
    }
    throw new RangeError('Cache anchor bank has no free slot below its capacity.');
  }

  // 재구축 비용이 싼 얕은 그룹을 먼저 밀어내되, 이번 fork의 원본은 깊이와
  // 무관하게 보존한다. 같은 단계 안에서는 기존 LRU 순서를 그대로 따른다.
  for (let position = snapshot.lruSlots.length - 1; position >= 0; position -= 1) {
    const slot = snapshot.lruSlots[position];
    if (slot === protectedSlot) continue;
    const state = snapshot.statesBySlot.get(slot);
    if (state === undefined) {
      throw new RangeError('Cache anchor bank LRU slot must reference a loaded state.');
    }
    if (state.anchorIndexes.length <= 1) return slot;
  }

  for (let position = snapshot.lruSlots.length - 1; position >= 0; position -= 1) {
    const slot = snapshot.lruSlots[position];
    if (slot !== protectedSlot) return slot;
  }
  throw new RangeError('Full cache anchor bank must have an evictable LRU slot.');
}

function createMatchedSelection(
  snapshot: CacheAnchorBankSnapshot,
  matchedSlot: number,
  previousState: CacheAnchorState,
): CacheAnchorBankSelection {
  return {
    consecutiveBankMisses: 0,
    lruSlots: [matchedSlot, ...snapshot.lruSlots.filter((slot) => slot !== matchedSlot)],
    previousState,
    slot: matchedSlot,
  };
}

function createForkSeedState(
  previousState: CacheAnchorState,
  prefixLength: number,
): CacheAnchorState {
  const anchorIndexes = previousState.anchorIndexes.filter(
    (anchorIndex) => anchorIndex < prefixLength,
  );
  const forkBoundaryIndex = prefixLength - 1;
  if (!anchorIndexes.includes(forkBoundaryIndex)) anchorIndexes.push(forkBoundaryIndex);
  const survivingAnchorIndexes = new Set(anchorIndexes);
  return {
    // 기존 생존 앵커의 안정성 증거는 내용까지 동일한 공통 프리픽스에 대한
    // 것이므로 그대로 승계한다. 새 fork 경계에는 admission을 미리 만들지
    // 않아 이번 요청을 최초 관찰로 세고, 다음 생존에서 정상 승격되게 한다.
    anchorAdmissions: previousState.anchorAdmissions.filter((admission) =>
      survivingAnchorIndexes.has(admission.anchorIndex),
    ),
    anchorIndexes,
    consecutiveFrontierDeaths: 0,
    fingerprints: previousState.fingerprints,
  };
}
