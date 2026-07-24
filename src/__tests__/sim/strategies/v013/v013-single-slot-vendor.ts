import type { LlmContentPart, LlmImagePart, LlmMessage, LlmMessageRole, LlmTextPart } from 'llm-io';

// Production cache logic vendored from the v0.13.0 release so the deployed
// single-slot baseline cannot drift with the live cache implementation.
export const V013_SINGLE_SLOT_SOURCE_COMMIT = '3f3d7733250877ef53d34ebf4a150a4f2447f159';

interface MessageFingerprint {
  role: LlmMessageRole;
  hash: string;
  tokenEstimate: number;
  textTokenEstimate?: number;
}

interface AnchorAdmission {
  anchorIndex: number;
  consecutiveSurvivals: number;
  admitted: boolean;
  requiresValidation: boolean;
}

export interface CacheAnchorState {
  anchorIndexes: number[];
  anchorAdmissions: AnchorAdmission[];
  consecutiveEpochResets: number;
  consecutiveFrontierDeaths: number;
  fingerprints: MessageFingerprint[];
}

interface CachePlan {
  anchorIndexes: number[];
  markingAnchorIndexes: number[];
  nextState: CacheAnchorState;
}

// ---- src/cache/constants.ts ----
export const EXPLICIT_PROMPT_CACHE_KEY = 'risuai:llm-gateway-provider:v1';
export const DISABLED_PROMPT_CACHE_KEY = 'risuai:llm-gateway-provider:v1:disabled';

// pluginStorage는 전 플러그인 공용 네임스페이스라 접두사가 필수다.
export const CACHE_ANCHOR_STATE_STORAGE_KEY = 'llm-gateway-provider:cache-anchor-state';

// OpenAI는 1024토큰 미만 프리픽스를 캐시하지 않고, explicit 문서상 non-cacheable
// 지점의 breakpoint는 400이 될 수도 있으므로 미달 추정 시 마킹을 생략한다.
export const MIN_CACHEABLE_PREFIX_TOKENS = 1024;
export const CACHE_BACKOFF_EPOCH_RESET_THRESHOLD = 3;
// frontier가 구조적 사망(성장·수축·시프트)을 이 횟수만큼 연속하면, 다음 새
// frontier 마킹을 보류해 어차피 죽을 심층 write 프리미엄을 차단한다.
export const FRONTIER_DEATH_MONITOR_THRESHOLD = 2;

// 위험 후보가 다음 요청에서도 겹치면 breakpoint로 admission한다. 실제 단가에선
// 한 번의 완전 hit으로 write premium을 상각하므로 첫 재사용 기회를 흘리지 않는다.
export const ANCHOR_ADMISSION_SURVIVAL_THRESHOLD = 1;

// v0.8 상태와 롤백 호환을 위해 admitted 후보는 기존 완료값 2로 저장한다.
export const ADMITTED_ANCHOR_SURVIVAL_COUNT = 2;

// 기존 마킹 prefix에서 한 번에 16k 토큰을 넘는 확장은 즉시 쓰지 않고 생존
// 검증 대상으로 돌린다. 실제 write는 gateway tokenizer가 정하지만, planner
// 추정치로 검증 없는 단일 오판의 write premium을 제한한다.
export const MAX_NEW_CACHE_WRITE_TOKENS = 16_384;

// ---- src/cache/utils/is-image-part.ts ----
export function isImagePart(part: LlmContentPart): part is LlmImagePart {
  return part.type === 'image';
}

// ---- src/cache/utils/is-text-part.ts ----
export function isTextPart(part: LlmContentPart): part is LlmTextPart {
  return part.type === 'text';
}

// ---- src/cache/planner/utils/estimate-tokens.ts ----
// 문자수/4 단일 근사는 한국어(≈2자/토큰)에서 토큰을 과소평가해 캐시 가능한
// 지점의 breakpoint가 생략된다. ASCII와 비ASCII를 나눠 추정하고, role framing
// 몫으로 메시지당 4토큰을 더한다.
export function estimateTokens(text: string): number {
  let asciiCount = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) < 128) asciiCount += 1;
  }
  const nonAsciiCount = text.length - asciiCount;
  return Math.ceil(asciiCount / 4 + nonAsciiCount / 2);
}

// ---- src/cache/planner/utils/fnv1a-hash.ts ----
// 동등성 비교 용도라 암호학적 강도가 필요 없다. 충돌 시 손해는 breakpoint
// 위치가 한 번 어긋나는 것(고아 세그먼트 1개)뿐이다.
export function fnv1aHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

// ---- src/cache/planner/fingerprint-message.ts ----
export function fingerprintMessage(message: LlmMessage): MessageFingerprint {
  let text = '';
  let imageTokenEstimate = 0;
  for (const part of message.content) {
    if (isTextPart(part)) text += part.text;
    if (isImagePart(part)) imageTokenEstimate += estimateImageTokens(part);
  }
  const textTokenEstimate = estimateTokens(text) + 4;
  return {
    role: message.role,
    hash: fnv1aHash(`${message.role}\0${JSON.stringify(message.content)}`),
    tokenEstimate: textTokenEstimate + imageTokenEstimate,
    textTokenEstimate,
  };
}

function estimateImageTokens(imagePart: LlmImagePart): number {
  const width = imagePart.width;
  const height = imagePart.height;
  if (
    typeof width !== 'number' ||
    !Number.isFinite(width) ||
    width <= 0 ||
    typeof height !== 'number' ||
    !Number.isFinite(height) ||
    height <= 0
  ) {
    // 압축된 Base64 바이트 수로는 vision patch 수를 복원할 수 없다. 크기를 모르면
    // 과대 추정을 만들지 않고 텍스트 lower bound만으로 최소 prefix를 판정한다.
    return 0;
  }
  return Math.ceil(width / 32) * Math.ceil(height / 32);
}

// ---- src/cache/planner/utils/fingerprints-equal.ts ----
export function fingerprintsEqual(left: MessageFingerprint, right: MessageFingerprint): boolean {
  return left.role === right.role && left.hash === right.hash;
}

// ---- src/cache/planner/utils/common-prefix-length.ts ----
export function commonPrefixLength(
  previous: readonly MessageFingerprint[],
  current: readonly MessageFingerprint[],
): number {
  const maxLength = Math.min(previous.length, current.length);
  let length = 0;
  while (length < maxLength && fingerprintsEqual(previous[length], current[length])) {
    length += 1;
  }
  return length;
}

// ---- src/cache/planner/utils/common-suffix-length.ts ----
export function commonSuffixLength(
  previous: readonly MessageFingerprint[],
  current: readonly MessageFingerprint[],
  prefixLength: number,
): number {
  const maxLength = Math.min(previous.length, current.length) - prefixLength;
  let length = 0;
  while (
    length < maxLength &&
    fingerprintsEqual(previous[previous.length - 1 - length], current[current.length - 1 - length])
  ) {
    length += 1;
  }
  return length;
}

// ---- src/cache/planner/utils/sum-token-estimates-between.ts ----
export function sumTokenEstimatesBetween(
  fingerprints: readonly MessageFingerprint[],
  leftAnchorIndex: number,
  rightAnchorIndex: number,
): number {
  let total = 0;
  for (let index = leftAnchorIndex + 1; index <= rightAnchorIndex; index += 1) {
    total += fingerprints[index].tokenEstimate;
  }
  return total;
}

/** 16K 신규-write admission guard용 합산. 이미지 토큰은 의도적으로 제외한다 —
 *  guard의 목적은 '금방 죽을 대형 write'의 오판 비용 제한인데, 이미지 블록은 재사용 간
 *  변동 가능성이 낮아 그 위험이 작고, 추정도 크기 미상 시 0이 되는 등 불확실하다
 *  (fingerprint-message 참고). 그래서 판정은 텍스트 하한 기준으로만 동작시키고,
 *  이미지가 큰 프리픽스가 즉시 admission될 수 있음은 감수한다.
 *  (1024 최소 프리픽스와 앵커 pruning 간격 계산에는 이미지 추정이 포함된다) */
export function sumTextTokenEstimatesBetween(
  fingerprints: readonly MessageFingerprint[],
  leftAnchorIndex: number,
  rightAnchorIndex: number,
): number {
  let total = 0;
  for (let index = leftAnchorIndex + 1; index <= rightAnchorIndex; index += 1) {
    // 저장된 v0.9 state는 전용 필드가 없으므로 종전 추정값을 안전하게 승계한다.
    total += fingerprints[index].textTokenEstimate ?? fingerprints[index].tokenEstimate;
  }
  return total;
}

// ---- src/cache/planner/utils/evict-closest-anchors.ts ----
export function evictClosestAnchors(
  anchorIndexes: readonly number[],
  fingerprints: readonly MessageFingerprint[],
): number[] {
  const retainedIndexes = [...anchorIndexes];
  while (retainedIndexes.length > 4) {
    let positionToRemove = -1;
    let closestPairTokenGap = Number.POSITIVE_INFINITY;
    for (let position = 0; position < retainedIndexes.length - 1; position += 1) {
      const rightPosition = position + 1;
      const removalCandidate =
        rightPosition === retainedIndexes.length - 1 ? position : rightPosition;
      // 정속 append에선 (직전 frontier, 새 frontier)가 항상 최근접 쌍이라 직전
      // frontier가 매턴 축출되고, exact-match 계약에서 직전 턴에 write한 엔트리가
      // 마커를 잃어 read 체인이 끊긴다 (60턴 append 실측 eff 21.2%). 마지막 두
      // 앵커(최신 frontier + 직전 frontier)를 보호해 write가 다음 턴에 회수되게 한다.
      if (removalCandidate >= retainedIndexes.length - 2) continue;
      const tokenGap = sumTokenEstimatesBetween(
        fingerprints,
        retainedIndexes[position],
        retainedIndexes[rightPosition],
      );
      if (tokenGap < closestPairTokenGap) {
        closestPairTokenGap = tokenGap;
        positionToRemove = removalCandidate;
      }
    }

    if (positionToRemove === -1) {
      throw new Error('Anchor eviction must find a removable position when over capacity.');
    }
    retainedIndexes.splice(positionToRemove, 1);
  }
  return retainedIndexes;
}

// ---- src/cache/planner/utils/normalize-anchor-indexes.ts ----
export function normalizeAnchorIndexes(
  candidates: readonly number[],
  fingerprints: readonly MessageFingerprint[],
): number[] {
  const sortedIndexes = [...new Set(candidates)].sort((left, right) => left - right);
  return evictClosestAnchors(sortedIndexes, fingerprints);
}

// ---- src/cache/planner/utils/resolve-first-turn-frontier.ts ----
// 첫 요청(또는 새 epoch)은 diff 대상이 없으므로, 유저 입력이 대체로 마지막
// user 롤 메시지로 들어온다는 가정 하에 그 직전을 안정 프리픽스의 끝으로 추정한다.
export function resolveFirstTurnFrontier(
  fingerprints: readonly MessageFingerprint[],
): number | null {
  for (let i = fingerprints.length - 1; i >= 0; i -= 1) {
    if (fingerprints[i].role === 'user') {
      return i > 0 ? i - 1 : null;
    }
  }
  return null;
}

// ---- src/cache/planner/utils/is-shifted-prefix-change.ts ----
// 같은 메시지 수의 변경을 두 부류로 가른다.
// - 제자리 교체(리롤·in-place 수정·churn): 분기점의 현재 메시지가 새 내용이라
//   직전 요청 어디에도 없다 → 이벤트당 손실이 유계라 스트라이크 대상이 아니다.
// - 시프트(트림 포화: 앞이 잘리고 뒤가 붙어 개수 유지): 분기점의 현재 메시지가
//   직전 요청의 더 뒤 인덱스에 그대로 있다 → 매턴 반복되는 구조적 사망이라
//   스트라이크로 센다.
// fingerprint 해시는 이미 상태에 저장돼 있어 추가 비용이 없다.
export function isShiftedPrefixChange(
  previous: readonly MessageFingerprint[],
  current: readonly MessageFingerprint[],
  prefixLength: number,
): boolean {
  const divergent = current[prefixLength];
  if (divergent === undefined) return false;

  for (let index = prefixLength + 1; index < previous.length; index += 1) {
    if (previous[index].hash === divergent.hash && previous[index].role === divergent.role) {
      return true;
    }
  }
  return false;
}

// ---- src/cache/planner/resolve-anchor-admissions.ts ----
export function resolveAnchorAdmissions(
  previousState: CacheAnchorState | null,
  anchorIndexes: readonly number[],
  prefixLength: number,
  requiresValidationIndexes: ReadonlySet<number>,
): AnchorAdmission[] {
  const previousAdmissions = new Map(
    (previousState === null ? [] : previousState.anchorAdmissions).map((admission) => [
      admission.anchorIndex,
      admission,
    ]),
  );
  const observations = anchorIndexes.map((anchorIndex): AnchorAdmission => {
    const previousAdmission = previousAdmissions.get(anchorIndex);
    const survived = previousAdmission !== undefined && prefixLength > anchorIndex;
    if (!survived) {
      return {
        admitted: false,
        anchorIndex,
        consecutiveSurvivals: 0,
        requiresValidation: requiresValidationIndexes.has(anchorIndex),
      };
    }
    if (previousAdmission.admitted) return previousAdmission;
    return {
      admitted: false,
      anchorIndex,
      consecutiveSurvivals: Math.min(
        ANCHOR_ADMISSION_SURVIVAL_THRESHOLD,
        previousAdmission.consecutiveSurvivals + 1,
      ),
      requiresValidation: previousAdmission.requiresValidation,
    };
  });

  return observations.map((admission) =>
    admission.admitted || admission.consecutiveSurvivals < ANCHOR_ADMISSION_SURVIVAL_THRESHOLD
      ? admission
      : {
          ...admission,
          admitted: true,
          consecutiveSurvivals: ADMITTED_ANCHOR_SURVIVAL_COUNT,
        },
  );
}

// ---- src/cache/planner/utils/create-first-turn-plan.ts ----
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

// ---- src/cache/planner/plan-cache-anchors.ts ----
// ===== breakpoint 자동 배치 =====
// 조립된 messages만으로는 로어북/채팅 경계를 구조적으로 알 수 없으므로,
// 직전 요청과의 양끝 diff(공통 프리픽스 + 공통 서픽스, 메시지 단위)로
// "삽입 구간(채팅 성장 지점)"을 찾아 그 끝에 frontier breakpoint를 찍는다.
// 공통 서픽스(후행 블록)는 매턴 위치가 밀려 프리픽스 캐시가 불가능하므로
// 캐시에 태우지 않는다.
//
// 직전 요청은 원문 대신 메시지별 fingerprint(해시)로 pluginStorage에 남긴다 —
// 대화 평문을 공용 저장소에 노출하지 않고, database.bin 용량도 메시지당
// 수십 바이트로 고정되며, 세이브 동기화를 타고 다른 기기에서도 이어진다.

export function planCacheAnchors(
  previousState: CacheAnchorState | null,
  messages: readonly LlmMessage[],
): CachePlan {
  const fingerprints = messages.map(fingerprintMessage);

  if (previousState === null || previousState.fingerprints.length === 0) {
    return createFirstTurnPlan(fingerprints);
  }

  const previous = previousState.fingerprints;
  const prefixLength = commonPrefixLength(previous, fingerprints);

  // 공통 프리픽스가 전혀 없으면 다른 채팅방/캐릭터로의 전면 교체다 — 이전
  // 상태를 승계하면 무의미한 폴백 앵커가 남으므로 새 epoch(첫 턴)으로 처리한다.
  if (prefixLength === 0) {
    // fingerprints를 새 epoch 값으로 갈아끼워도 연속 실패 횟수는 이어가야
    // 매턴 변하는 선두 프리셋을 감지할 수 있다.
    return createFirstTurnPlan(fingerprints, previousState.consecutiveEpochResets + 1);
  }

  const suffixLength = commonSuffixLength(previous, fingerprints, prefixLength);
  if (prefixLength >= fingerprints.length) {
    // 현재 요청이 직전 요청의 프리픽스에 통째로 포함되는 경우(주의: 직전이
    // 현재의 프리픽스인 일반 성장과 반대 방향이다):
    // - 길이까지 같으면 동일 요청(리롤) — 현재 범위의 기존 앵커를 유지해
    //   후행 블록이 캐시에 실리지 않게 한다.
    // - 더 짧아졌으면(브랜치 삭제·요약 교체 등) 기존 앵커가 범위를 벗어날
    //   수 있어 첫 턴 정책으로 재추정한다.
    if (fingerprints.length < previous.length) {
      return createFirstTurnPlan(fingerprints);
    }

    const anchorIndexes = previousState.anchorIndexes.filter(
      (anchorIndex) => anchorIndex < fingerprints.length,
    );
    const anchorAdmissions = resolveAnchorAdmissions(
      previousState,
      anchorIndexes,
      prefixLength,
      new Set(),
    );
    return {
      anchorIndexes,
      markingAnchorIndexes: anchorAdmissions
        .filter((admission) => !admission.requiresValidation || admission.admitted)
        .map((admission) => admission.anchorIndex),
      // 동일 요청 리롤은 frontier가 그대로 살아남은 것이므로 사망 이력을 지운다.
      nextState: {
        anchorAdmissions,
        anchorIndexes,
        consecutiveEpochResets: 0,
        consecutiveFrontierDeaths: 0,
        fingerprints,
      },
    };
  }

  const candidates = previousState.anchorIndexes.filter(
    (anchorIndex) => anchorIndex < prefixLength,
  );
  const previousFrontierIndex = previousState.anchorIndexes.at(-1);
  if (previousFrontierIndex !== undefined && prefixLength <= previousFrontierIndex) {
    candidates.push(prefixLength - 1);
  }
  candidates.push(fingerprints.length - suffixLength - 1);

  const anchorIndexes = normalizeAnchorIndexes(candidates, fingerprints);
  const consecutiveFrontierDeaths = resolveFrontierDeaths(
    previousState,
    fingerprints,
    prefixLength,
  );
  const requiresValidationIndexes = resolveRequiresValidationIndexes(
    previousState,
    anchorIndexes,
    fingerprints,
    prefixLength,
  );
  const anchorAdmissions = resolveAnchorAdmissions(
    previousState,
    anchorIndexes,
    prefixLength,
    requiresValidationIndexes,
  );
  // 사망이 임계에 닿으면 어차피 죽을 새 frontier의 마킹만 보류한다. 얕은 안정
  // 앵커는 계속 마킹해 read를 유지하고, frontier가 살아남는 턴이 오면 카운터가
  // 리셋되어 자동 재개된다. 실측 계약상(probe-cache-partial) 히트는 현재 요청
  // marker와 entry의 exact 일치에서만 발생하므로, 죽을 지점의 write 프리미엄
  // 차단이 read 손실 없이 성립한다.
  const latestAnchorIndex = anchorIndexes.at(-1);
  const markingAnchorIndexes = anchorAdmissions
    .filter(
      (admission) =>
        (!admission.requiresValidation || admission.admitted) &&
        !(
          consecutiveFrontierDeaths >= FRONTIER_DEATH_MONITOR_THRESHOLD &&
          admission.anchorIndex === latestAnchorIndex
        ),
    )
    .map((admission) => admission.anchorIndex);

  return {
    anchorIndexes,
    markingAnchorIndexes,
    nextState: {
      anchorAdmissions,
      anchorIndexes,
      consecutiveEpochResets: 0,
      consecutiveFrontierDeaths,
      fingerprints,
    },
  };
}

function resolveRequiresValidationIndexes(
  previousState: CacheAnchorState,
  anchorIndexes: readonly number[],
  currentFingerprints: readonly MessageFingerprint[],
  prefixLength: number,
): ReadonlySet<number> {
  const previousAdmissions = new Map(
    previousState.anchorAdmissions.map((admission) => [admission.anchorIndex, admission]),
  );
  const deepestEligiblePreviousIndex = previousState.anchorAdmissions.reduce(
    (deepestIndex, admission) =>
      prefixLength > admission.anchorIndex && (!admission.requiresValidation || admission.admitted)
        ? Math.max(deepestIndex, admission.anchorIndex)
        : deepestIndex,
    -1,
  );
  const structuralFrontierDeath = isStructuralFrontierDeath(
    previousState,
    currentFingerprints,
    prefixLength,
  );
  const requiresValidationIndexes = new Set<number>();

  anchorIndexes.forEach((anchorIndex) => {
    const previousAdmission = previousAdmissions.get(anchorIndex);
    if (previousAdmission !== undefined && prefixLength > anchorIndex) return;

    const estimatedNewWriteTokens =
      anchorIndex <= deepestEligiblePreviousIndex
        ? 0
        : sumTextTokenEstimatesBetween(
            currentFingerprints,
            deepestEligiblePreviousIndex,
            anchorIndex,
          );
    if (structuralFrontierDeath || estimatedNewWriteTokens > MAX_NEW_CACHE_WRITE_TOKENS) {
      requiresValidationIndexes.add(anchorIndex);
    }
  });

  return requiresValidationIndexes;
}

function isStructuralFrontierDeath(
  previousState: CacheAnchorState,
  currentFingerprints: readonly MessageFingerprint[],
  prefixLength: number,
): boolean {
  const previousFrontierIndex = previousState.anchorIndexes.at(-1);
  if (previousFrontierIndex === undefined || prefixLength > previousFrontierIndex) return false;

  const sameLength = previousState.fingerprints.length === currentFingerprints.length;
  return (
    !sameLength ||
    isShiftedPrefixChange(previousState.fingerprints, currentFingerprints, prefixLength)
  );
}

// frontier 사망을 위치 기준으로 판별한다. 같은 메시지 수의 제자리 교체(리롤·
// in-place 수정·churn)는 이벤트당 손실이 유계라 세지 않고 카운터만 유지하며,
// 시프트(트림 포화)·성장·수축 사망은 구조적 반복이라 누적한다. 생존은 리셋한다.
function resolveFrontierDeaths(
  previousState: CacheAnchorState,
  currentFingerprints: readonly MessageFingerprint[],
  prefixLength: number,
): number {
  const previousFrontierIndex = previousState.anchorIndexes.at(-1);
  if (previousFrontierIndex === undefined || prefixLength > previousFrontierIndex) return 0;

  if (!isStructuralFrontierDeath(previousState, currentFingerprints, prefixLength)) {
    return previousState.consecutiveFrontierDeaths;
  }
  return previousState.consecutiveFrontierDeaths + 1;
}

// ---- src/cache/breakpoint/constants.ts ----
// llm-io는 assistant 메시지를 문자열 content로 직렬화해 breakpoint 마킹이
// 유실된다(to-openai-message.ts). 실측에서도 llmgateway는 assistant 지점 마커를
// 200으로 수락하지만 1,531토큰 프리픽스의 cache write가 0이라 엔트리를 만들지 않았다.
// content part 배열이 유지되는 system/user에만 마킹하고, 아니면 앞쪽으로 물러난다.
export const MARKABLE_ROLES: ReadonlySet<LlmMessageRole> = new Set(['system', 'user']);

// ---- src/cache/breakpoint/utils/mark-breakpoint.ts ----
export function markBreakpoint(message: LlmMessage): LlmMessage {
  let lastCacheablePartIndex = -1;
  message.content.forEach((part, index) => {
    if (isTextPart(part) || isImagePart(part)) lastCacheablePartIndex = index;
  });
  if (lastCacheablePartIndex === -1) return message;

  return {
    ...message,
    content: message.content.map((part, index) =>
      index === lastCacheablePartIndex && (isTextPart(part) || isImagePart(part))
        ? { ...part, cacheBreakpoint: { mode: 'explicit' } }
        : part,
    ),
  };
}

// ---- src/cache/breakpoint/utils/passes-minimum-prefix-tokens.ts ----
export function passesMinimumPrefixTokens(
  fingerprints: readonly MessageFingerprint[],
  index: number,
): boolean {
  let total = 0;
  for (let i = 0; i <= index; i += 1) {
    total += fingerprints[i].tokenEstimate;
  }
  return total >= MIN_CACHEABLE_PREFIX_TOKENS;
}

// ---- src/cache/breakpoint/utils/to-markable-index.ts ----
export function toMarkableIndex(messages: readonly LlmMessage[], index: number): number | null {
  for (let i = index; i >= 0; i -= 1) {
    if (
      MARKABLE_ROLES.has(messages[i].role) &&
      messages[i].content.some((part) => isTextPart(part) || isImagePart(part))
    ) {
      return i;
    }
  }
  return null;
}

// ---- src/cache/backoff/is-cache-backoff-active.ts ----
export function isCacheBackoffActive(state: CacheAnchorState | null): boolean {
  return state !== null && state.consecutiveEpochResets >= CACHE_BACKOFF_EPOCH_RESET_THRESHOLD;
}

// ---- src/cache/breakpoint/mark-cache-breakpoints.ts ----
export function markCacheBreakpoints(messages: LlmMessage[], plan: CachePlan): LlmMessage[] {
  if (isCacheBackoffActive(plan.nextState)) {
    // 연속 epoch 리셋 중에는 쓰기 프리미엄 손실을 실시간 차단하되, plan의 diff
    // 상태는 계속 저장해 안정 프리픽스가 돌아온 즉시 자동 복구한다.
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
