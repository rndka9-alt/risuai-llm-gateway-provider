import type {
  LlmContentPart,
  LlmMessage,
  LlmMessageRole,
  LlmTextPart,
  OpenAIChatCompletionsExtraBody,
} from 'llm-io';
import { z } from 'zod';

export const PROMPT_CACHE_MODE_ARGUMENT = 'prompt_cache_mode';
export const EXPLICIT_PROMPT_CACHE_KEY = 'risuai:llm-gateway-provider:v1';
export const DISABLED_PROMPT_CACHE_KEY = 'risuai:llm-gateway-provider:v1:disabled';

// pluginStorage는 전 플러그인 공용 네임스페이스라 접두사가 필수다.
export const CACHE_ANCHOR_STATE_STORAGE_KEY = 'llm-gateway-provider:cache-anchor-state';

// OpenAI는 1024토큰 미만 프리픽스를 캐시하지 않고, explicit 문서상 non-cacheable
// 지점의 breakpoint는 400이 될 수도 있으므로 미달 추정 시 마킹을 생략한다.
export const MIN_CACHEABLE_PREFIX_TOKENS = 1024;
export const CACHE_BACKOFF_EPOCH_RESET_THRESHOLD = 3;

export type PromptCacheMode = 'explicit' | 'disabled';

// 실측으로 캐시 이득(읽기 0.1×)과 무해성(잘못된 BP는 조용한 무시)이 확인되어
// 미지정 시 explicit을 기본값으로 켠다.
export function resolvePromptCacheMode(value: string | undefined): PromptCacheMode {
  return value?.trim() === 'disabled' ? 'disabled' : 'explicit';
}

export function isExplicitPromptCacheMode(mode: PromptCacheMode): boolean {
  return mode === 'explicit';
}

export function getPromptCacheKey(mode: PromptCacheMode): string {
  return isExplicitPromptCacheMode(mode) ? EXPLICIT_PROMPT_CACHE_KEY : DISABLED_PROMPT_CACHE_KEY;
}

export function createPromptCacheExtraBody(
  mode: PromptCacheMode,
): OpenAIChatCompletionsExtraBody {
  return {
    prompt_cache_key: getPromptCacheKey(mode),
    prompt_cache_options: {
      mode: 'explicit',
      // 현재 지원되는 유일한 값이자 기본값이지만, 정책이 요청에 드러나도록 명시한다.
      ttl: '30m',
    },
  };
}

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

const messageFingerprintSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  hash: z.string(),
  tokenEstimate: z.number(),
});

// 구버전 frontierIndex 상태는 anchorIndexes가 없어 파싱에 실패하고 새 epoch로
// 회복한다. 캐시 최적화 상태라 손실이 무해하고, 경계를 추측해 승계하는 것보다 안전하다.
const cacheAnchorStateSchema = z
  .object({
    anchorIndexes: z.array(z.number().int().nonnegative()).max(4),
    consecutiveEpochResets: z.number().int().nonnegative().default(0),
    fingerprints: z.array(messageFingerprintSchema),
  })
  .superRefine((state, context) => {
    state.anchorIndexes.forEach((anchorIndex, position) => {
      if (anchorIndex >= state.fingerprints.length) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'anchor index must reference a fingerprint',
          path: ['anchorIndexes', position],
        });
      }
      if (position > 0 && state.anchorIndexes[position - 1] >= anchorIndex) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'anchor indexes must be strictly ascending',
          path: ['anchorIndexes', position],
        });
      }
    });
  });

export type MessageFingerprint = z.infer<typeof messageFingerprintSchema>;
export type CacheAnchorState = z.infer<typeof cacheAnchorStateSchema>;
export type CacheBackoffTransition = 'activated' | 'released';

export interface CachePlan {
  anchorIndexes: number[];
  nextState: CacheAnchorState;
}

export function isCacheBackoffActive(state: CacheAnchorState | null): boolean {
  return (
    state !== null &&
    state.consecutiveEpochResets >= CACHE_BACKOFF_EPOCH_RESET_THRESHOLD
  );
}

export function resolveCacheBackoffTransition(
  previousState: CacheAnchorState | null,
  nextState: CacheAnchorState,
): CacheBackoffTransition | null {
  const wasActive = isCacheBackoffActive(previousState);
  const isActive = isCacheBackoffActive(nextState);
  if (wasActive === isActive) return null;
  return isActive ? 'activated' : 'released';
}

function isTextPart(part: LlmContentPart): part is LlmTextPart {
  return part.type === 'text';
}

// 동등성 비교 용도라 암호학적 강도가 필요 없다. 충돌 시 손해는 breakpoint
// 위치가 한 번 어긋나는 것(고아 세그먼트 1개)뿐이다.
function fnv1aHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

// 문자수/4 단일 근사는 한국어(≈2자/토큰)에서 토큰을 과소평가해 캐시 가능한
// 지점의 breakpoint가 생략된다. ASCII와 비ASCII를 나눠 추정하고, role framing
// 몫으로 메시지당 4토큰을 더한다.
function estimateTokens(text: string): number {
  let asciiCount = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) < 128) asciiCount += 1;
  }
  const nonAsciiCount = text.length - asciiCount;
  return Math.ceil(asciiCount / 4 + nonAsciiCount / 2);
}

export function fingerprintMessage(message: LlmMessage): MessageFingerprint {
  let text = '';
  for (const part of message.content) {
    if (isTextPart(part)) text += part.text;
  }
  return {
    role: message.role,
    hash: fnv1aHash(`${message.role}\0${JSON.stringify(message.content)}`),
    tokenEstimate: estimateTokens(text) + 4,
  };
}

function fingerprintsEqual(left: MessageFingerprint, right: MessageFingerprint): boolean {
  return left.role === right.role && left.hash === right.hash;
}

function commonPrefixLength(
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

function commonSuffixLength(
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

// 첫 요청(또는 새 epoch)은 diff 대상이 없으므로, 유저 입력이 대체로 마지막
// user 롤 메시지로 들어온다는 가정 하에 그 직전을 안정 프리픽스의 끝으로 추정한다.
function resolveFirstTurnFrontier(fingerprints: readonly MessageFingerprint[]): number | null {
  for (let i = fingerprints.length - 1; i >= 0; i -= 1) {
    if (fingerprints[i].role === 'user') {
      return i > 0 ? i - 1 : null;
    }
  }
  return null;
}

function createFirstTurnPlan(
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

function sumTokenEstimatesBetween(
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

function evictClosestAnchors(
  anchorIndexes: readonly number[],
  fingerprints: readonly MessageFingerprint[],
): number[] {
  const retainedIndexes = [...anchorIndexes];
  while (retainedIndexes.length > 4) {
    let closestPairStart = 0;
    let closestPairTokenGap = Number.POSITIVE_INFINITY;
    for (let position = 0; position < retainedIndexes.length - 1; position += 1) {
      const tokenGap = sumTokenEstimatesBetween(
        fingerprints,
        retainedIndexes[position],
        retainedIndexes[position + 1],
      );
      if (tokenGap < closestPairTokenGap) {
        closestPairStart = position;
        closestPairTokenGap = tokenGap;
      }
    }

    const rightPosition = closestPairStart + 1;
    const positionToRemove =
      rightPosition === retainedIndexes.length - 1 ? closestPairStart : rightPosition;
    retainedIndexes.splice(positionToRemove, 1);
  }
  return retainedIndexes;
}

function normalizeAnchorIndexes(
  candidates: readonly number[],
  fingerprints: readonly MessageFingerprint[],
): number[] {
  const sortedIndexes = [...new Set(candidates)].sort((left, right) => left - right);
  return evictClosestAnchors(sortedIndexes, fingerprints);
}

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
    return createFirstTurnPlan(
      fingerprints,
      previousState.consecutiveEpochResets + 1,
    );
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
    return {
      anchorIndexes,
      nextState: { anchorIndexes, consecutiveEpochResets: 0, fingerprints },
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

  return {
    anchorIndexes,
    nextState: { anchorIndexes, consecutiveEpochResets: 0, fingerprints },
  };
}

// llm-io는 assistant 메시지를 문자열 content로 직렬화해 breakpoint 마킹이
// 유실된다(to-openai-message.ts). 실측에서도 llmgateway는 assistant 지점 마커를
// 200으로 수락하지만 1,531토큰 프리픽스의 cache write가 0이라 엔트리를 만들지 않았다.
// content part 배열이 유지되는 system/user에만 마킹하고, 아니면 앞쪽으로 물러난다.
const MARKABLE_ROLES: ReadonlySet<LlmMessageRole> = new Set(['system', 'user']);

function toMarkableIndex(messages: readonly LlmMessage[], index: number): number | null {
  for (let i = index; i >= 0; i -= 1) {
    if (MARKABLE_ROLES.has(messages[i].role) && messages[i].content.some(isTextPart)) {
      return i;
    }
  }
  return null;
}

function passesMinimumPrefixTokens(
  fingerprints: readonly MessageFingerprint[],
  index: number,
): boolean {
  let total = 0;
  for (let i = 0; i <= index; i += 1) {
    total += fingerprints[i].tokenEstimate;
  }
  return total >= MIN_CACHEABLE_PREFIX_TOKENS;
}

function markBreakpoint(message: LlmMessage): LlmMessage {
  let lastTextPartIndex = -1;
  message.content.forEach((part, index) => {
    if (isTextPart(part)) lastTextPartIndex = index;
  });
  if (lastTextPartIndex === -1) return message;

  return {
    ...message,
    content: message.content.map((part, index) =>
      index === lastTextPartIndex && isTextPart(part)
        ? { ...part, cacheBreakpoint: { mode: 'explicit' } }
        : part,
    ),
  };
}

export function markCacheBreakpoints(messages: LlmMessage[], plan: CachePlan): LlmMessage[] {
  if (isCacheBackoffActive(plan.nextState)) {
    // 연속 epoch 리셋 중에는 쓰기 프리미엄 손실을 실시간 차단하되, plan의 diff
    // 상태는 계속 저장해 안정 프리픽스가 돌아온 즉시 자동 복구한다.
    return messages;
  }

  const markableIndexes = new Set<number>();
  for (const anchorIndex of plan.anchorIndexes) {
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

// ===== 상태 저장 =====

// 손상·부재 상태는 새 epoch로 시작하는 것이 안전한 기본값이다. 여기서 throw하면
// 저장이 영영 갱신되지 않아 매 요청 실패가 반복되므로, null 반환으로 자가 회복한다.
export async function loadCacheAnchorState(): Promise<CacheAnchorState | null> {
  const raw = await risuai.pluginStorage.getItem(CACHE_ANCHOR_STATE_STORAGE_KEY);
  if (typeof raw !== 'string' || raw === '') return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.error('[llm-gateway-provider] corrupted cache anchor state; starting a new epoch', error);
    return null;
  }
  const result = cacheAnchorStateSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

export async function saveCacheAnchorState(state: CacheAnchorState): Promise<void> {
  await risuai.pluginStorage.setItem(CACHE_ANCHOR_STATE_STORAGE_KEY, JSON.stringify(state));
}
