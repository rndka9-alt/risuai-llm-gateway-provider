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

export type PromptCacheMode = 'explicit' | 'disabled';

export function resolvePromptCacheMode(value: string | undefined): PromptCacheMode {
  return value?.trim() === 'explicit' ? 'explicit' : 'disabled';
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
    prompt_cache_options: { mode: 'explicit' },
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

const cacheAnchorStateSchema = z.object({
  deepestDivergenceIndex: z.number().nullable(),
  fingerprints: z.array(messageFingerprintSchema),
  frontierIndex: z.number().nullable(),
});

export type MessageFingerprint = z.infer<typeof messageFingerprintSchema>;
export type CacheAnchorState = z.infer<typeof cacheAnchorStateSchema>;

export interface CachePlan {
  fallbackIndex: number | null;
  frontierIndex: number | null;
  nextState: CacheAnchorState;
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

function createFirstTurnPlan(fingerprints: MessageFingerprint[]): CachePlan {
  const frontierIndex = resolveFirstTurnFrontier(fingerprints);
  return {
    fallbackIndex: null,
    frontierIndex,
    nextState: { deepestDivergenceIndex: null, fingerprints, frontierIndex },
  };
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
    return createFirstTurnPlan(fingerprints);
  }

  const suffixLength = commonSuffixLength(previous, fingerprints, prefixLength);

  let frontierIndex: number | null;
  if (prefixLength >= fingerprints.length) {
    // 현재 요청이 직전 요청의 프리픽스에 통째로 포함되는 경우(주의: 직전이
    // 현재의 프리픽스인 일반 성장과 반대 방향이다):
    // - 길이까지 같으면 동일 요청(리롤) — 이전 frontier를 유지해 후행 블록이
    //   캐시에 실리지 않게 한다.
    // - 더 짧아졌으면(브랜치 삭제·요약 교체 등) 이전 frontier가 범위를 벗어날
    //   수 있어 첫 턴 정책으로 재추정한다.
    frontierIndex =
      previousState.frontierIndex !== null && previousState.frontierIndex < fingerprints.length
        ? previousState.frontierIndex
        : resolveFirstTurnFrontier(fingerprints);
  } else {
    frontierIndex = fingerprints.length - suffixLength - 1;
  }

  // 안정 구간이라 믿었던 지점(이전 frontier) 안쪽이 깨지면 분기 이벤트 —
  // 관측된 가장 얕은 일치 경계를 폴백 앵커로 남겨 다음 분기 때 부분 히트를 노린다.
  let deepestDivergenceIndex = previousState.deepestDivergenceIndex;
  if (previousState.frontierIndex !== null && prefixLength <= previousState.frontierIndex) {
    const candidate = prefixLength - 1;
    deepestDivergenceIndex =
      deepestDivergenceIndex === null ? candidate : Math.min(deepestDivergenceIndex, candidate);
  }

  const fallbackIndex =
    deepestDivergenceIndex !== null &&
    frontierIndex !== null &&
    deepestDivergenceIndex < frontierIndex
      ? deepestDivergenceIndex
      : null;

  return {
    fallbackIndex,
    frontierIndex,
    nextState: { deepestDivergenceIndex, fingerprints, frontierIndex },
  };
}

// llm-io는 assistant 메시지를 문자열 content로 직렬화해 breakpoint 마킹이
// 유실된다(to-openai-message.ts). content part 배열이 유지되는 system/user
// 메시지에만 마킹하고, 아니면 앞쪽으로 물러난다.
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
  const markableIndexes = new Set<number>();
  for (const anchorIndex of [plan.fallbackIndex, plan.frontierIndex]) {
    if (anchorIndex === null) continue;
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
