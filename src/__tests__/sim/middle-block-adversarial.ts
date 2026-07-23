import type { LlmMessage } from 'llm-io';
import type { GoldenTrajectory, TrajectoryRequest } from './replay';

const REQUESTS_PER_TRAJECTORY = 36;
const FIXED_HEAD_TOKENS = 8_000;
const PHASE_TOKENS = 1_500;
const FIXED_MIDDLE_TOKENS = 4_000;
const FIXED_TAIL_TOKENS = 8_000;
const DEFAULT_ELAPSED_MINUTES = 2;

export interface AdversarialTrajectory extends GoldenTrajectory {
  /** 이 trajectory가 공격하는 TTL-aware recurrence admission의 가정. */
  attackSurface: string;
}

function makeText(label: string, tokens: number): string {
  const sentence = `[${label}] Adversarial middle-block simulation keeps deterministic prose for exact-prefix accounting. `;
  const characters = Math.max(8, Math.round(tokens * 4));
  return sentence.repeat(Math.ceil(characters / sentence.length)).slice(0, characters);
}

// 같은 label은 같은 내용을 만들므로 fingerprint(content hash)도 동일하다.
// phase 재등장은 객체 재사용이 아니라 label 재사용으로 표현한다.
function makeMessage(role: LlmMessage['role'], label: string, tokens: number): LlmMessage {
  return { role, content: [{ type: 'text', text: makeText(label, tokens) }] };
}

interface TrajectoryBlueprint {
  attackSurface: string;
  elapsedMinutes: number;
  id: string;
  label: string;
  prefixForTurn: (turn: number) => readonly LlmMessage[];
  requestCount: number;
}

function buildTrajectory(blueprint: TrajectoryBlueprint): AdversarialTrajectory {
  const history: LlmMessage[] = [];
  const requests: TrajectoryRequest[] = [];

  for (let turn = 1; turn <= blueprint.requestCount; turn += 1) {
    history.push(makeMessage('user', `${blueprint.id}-user-${turn}`, 120 + (turn % 4) * 20));
    requests.push({
      elapsedMinutes: blueprint.elapsedMinutes,
      messages: [...blueprint.prefixForTurn(turn), ...history],
    });
    history.push(
      makeMessage('assistant', `${blueprint.id}-assistant-${turn}`, 500 + (turn % 5) * 50),
    );
  }

  return {
    attackSurface: blueprint.attackSurface,
    id: blueprint.id,
    label: blueprint.label,
    requests,
  };
}

// 각 phase가 정확히 연속 2회만 등장하고 소멸한다. "재등장 증거"가 확정되는
// 두 번째 관측이 곧 마지막 등장이라, admission은 죽기 직전의 phase에 깊은
// 앵커를 투자하고, 정작 다음 턴에 확실히 읽혔을 첫 관측 턴의 frontier는
// 보류한다 — 증거 기반 투자의 타이밍을 정확히 반대로 찌르는 패턴.
function createDoubleTapTrajectory(): AdversarialTrajectory {
  const id = 'adv-double-tap';
  const fixedHead = makeMessage('system', `${id}-fixed-head`, FIXED_HEAD_TOKENS);
  const fixedTail = makeMessage('system', `${id}-fixed-tail`, FIXED_TAIL_TOKENS);
  return buildTrajectory({
    attackSurface: '재등장 증거가 미래 재등장을 보장한다는 가정',
    elapsedMinutes: DEFAULT_ELAPSED_MINUTES,
    id,
    label: 'phase가 연속 2회만 등장 후 소멸',
    prefixForTurn: (turn) => [
      fixedHead,
      makeMessage('system', `${id}-phase-${Math.floor((turn - 1) / 2)}`, PHASE_TOKENS),
      fixedTail,
    ],
    requestCount: REQUESTS_PER_TRAJECTORY,
  });
}

// X는 2상태로 빠르게 재등장하지만 head가 매 요청 유일하다(타임스탬프·랜덤
// 인젝터 류). 전체 prefix는 한 번도 반복되지 않는데, message[1] 단독 hash로
// keying한 phase identity는 "재등장 중"으로 판단해 깊은 앵커를 계속 쓴다.
function createUniqueHeadTrajectory(): AdversarialTrajectory {
  const id = 'adv-unique-head';
  const fixedTail = makeMessage('system', `${id}-fixed-tail`, FIXED_TAIL_TOKENS);
  return buildTrajectory({
    attackSurface: 'cumulative prefix 없이 단독 message hash로 잡은 phase identity',
    elapsedMinutes: DEFAULT_ELAPSED_MINUTES,
    id,
    label: '매 요청 유일한 head + 2상태 회전 X',
    prefixForTurn: (turn) => [
      makeMessage('system', `${id}-unique-head-${turn}`, FIXED_HEAD_TOKENS),
      makeMessage('system', `${id}-phase-${(turn - 1) % 2}`, PHASE_TOKENS),
      fixedTail,
    ],
    requestCount: REQUESTS_PER_TRAJECTORY,
  });
}

// 4상태 회전이라 요청 수 기준(거리 4 ≤ 14창)으로는 admit되지만, 요청 간격이
// 10분이라 실제 재등장 간격은 40분 > TTL 30분 — 깊은 앵커는 항상 만료 후에
// 돌아온다. 요청 수를 wall-clock의 proxy로 쓴 창의 느린 세션 방향 실패.
function createSlowClockTrajectory(): AdversarialTrajectory {
  const id = 'adv-slow-clock';
  const fixedHead = makeMessage('system', `${id}-fixed-head`, FIXED_HEAD_TOKENS);
  const fixedTail = makeMessage('system', `${id}-fixed-tail`, FIXED_TAIL_TOKENS);
  return buildTrajectory({
    attackSurface: '요청 수 재등장 창이 wall-clock TTL을 대변한다는 가정 (느린 세션)',
    elapsedMinutes: 10,
    id,
    label: '4상태 회전 × 10분 간격 (실제 주기 40분)',
    prefixForTurn: (turn) => [
      fixedHead,
      makeMessage('system', `${id}-phase-${(turn - 1) % 4}`, PHASE_TOKENS),
      fixedTail,
    ],
    requestCount: REQUESTS_PER_TRAJECTORY,
  });
}

// 16상태 회전 × 1.5분 간격 = 재등장 24분 < TTL 30분으로 캐시는 살아 있지만,
// 요청 수 창(거리 16 > 14)이 admission을 거부한다 — 같은 proxy의 빠른 세션
// 방향 실패로, slow-clock과 쌍을 이룬다. 96요청 long 변형은 재등장 증거
// 기반 admission의 학습비가 회수되는 구간까지 포함해, 짧은 세션(36요청)의
// 미회수 구간만 보고 admission을 기각하지 않도록 한다.
function createFastClockTrajectory(options: {
  id: string;
  requestCount: number;
}): AdversarialTrajectory {
  const fixedHead = makeMessage('system', `${options.id}-fixed-head`, FIXED_HEAD_TOKENS);
  const fixedTail = makeMessage('system', `${options.id}-fixed-tail`, FIXED_TAIL_TOKENS);
  return buildTrajectory({
    attackSurface: '요청 수 재등장 창이 wall-clock TTL을 대변한다는 가정 (빠른 세션)',
    elapsedMinutes: 1.5,
    id: options.id,
    label: `16상태 회전 × 1.5분 간격 (실제 주기 24분), ${options.requestCount}요청`,
    prefixForTurn: (turn) => [
      fixedHead,
      makeMessage('system', `${options.id}-phase-${(turn - 1) % 16}`, PHASE_TOKENS),
      fixedTail,
    ],
    requestCount: options.requestCount,
  });
}

// 주기 2의 X1과 주기 3의 X2가 독립 회전한다(로어북 슬롯 2개가 따로 토글되는
// 모양). index 1(X1)만 보는 identity는 주기 2로 admit하지만, X2 뒤 깊은
// 앵커의 실제 prefix 재등장 주기는 LCM=6이다 — phase가 블록 하나라는 가정 공격.
function createDualRotatorTrajectory(): AdversarialTrajectory {
  const id = 'adv-dual-rotator';
  const fixedHead = makeMessage('system', `${id}-fixed-head`, FIXED_HEAD_TOKENS);
  const fixedMiddle = makeMessage('system', `${id}-fixed-middle`, FIXED_MIDDLE_TOKENS);
  const fixedTail = makeMessage('system', `${id}-fixed-tail`, FIXED_TAIL_TOKENS);
  return buildTrajectory({
    attackSurface: '변동 구간이 단일 블록이라는 가정 — 독립 주기 회전 블록 2개',
    elapsedMinutes: DEFAULT_ELAPSED_MINUTES,
    id,
    label: '주기 2 X1 + 주기 3 X2 독립 회전',
    prefixForTurn: (turn) => [
      fixedHead,
      makeMessage('system', `${id}-rotator-a-${(turn - 1) % 2}`, PHASE_TOKENS),
      fixedMiddle,
      makeMessage('system', `${id}-rotator-b-${(turn - 1) % 3}`, PHASE_TOKENS),
      fixedTail,
    ],
    requestCount: REQUESTS_PER_TRAJECTORY,
  });
}

export function createAdversarialTrajectories(): readonly AdversarialTrajectory[] {
  return [
    createDoubleTapTrajectory(),
    createUniqueHeadTrajectory(),
    createSlowClockTrajectory(),
    createFastClockTrajectory({ id: 'adv-fast-clock', requestCount: REQUESTS_PER_TRAJECTORY }),
    createFastClockTrajectory({ id: 'adv-fast-clock-long', requestCount: 96 }),
    createDualRotatorTrajectory(),
  ];
}
