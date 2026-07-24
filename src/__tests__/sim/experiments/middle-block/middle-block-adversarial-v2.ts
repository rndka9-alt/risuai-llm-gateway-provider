import type { LlmMessage } from 'llm-io';
import type { SimulationScenario, ScenarioRequest } from '../../scenarios';

const FIXED_HEAD_TOKENS = 8_000;
const PHASE_TOKENS = 1_500;
const FIXED_TAIL_TOKENS = 8_000;
const LARGE_TAIL_TOKENS = 24_000;

export interface AdversarialV2Scenario extends SimulationScenario {
  /** 이 scenario가 공격하는 wall-clock recurrence admission의 가정. */
  attackSurface: string;
}

function makeText(label: string, tokens: number): string {
  const sentence = `[${label}] Adversarial v2 simulation keeps deterministic prose for exact-prefix accounting. `;
  const characters = Math.max(8, Math.round(tokens * 4));
  return sentence.repeat(Math.ceil(characters / sentence.length)).slice(0, characters);
}

function makeMessage(role: LlmMessage['role'], label: string, tokens: number): LlmMessage {
  return { role, content: [{ type: 'text', text: makeText(label, tokens) }] };
}

interface AppendScenarioBlueprint {
  attackSurface: string;
  elapsedMinutesForTurn: (turn: number) => number;
  id: string;
  label: string;
  phaseForTurn: (turn: number) => LlmMessage;
  requestCount: number;
  tailForTurn: (turn: number) => LlmMessage;
}

function buildAppendScenario(blueprint: AppendScenarioBlueprint): AdversarialV2Scenario {
  const fixedHead = makeMessage('system', `${blueprint.id}-fixed-head`, FIXED_HEAD_TOKENS);
  const history: LlmMessage[] = [];
  const requests: ScenarioRequest[] = [];

  for (let turn = 1; turn <= blueprint.requestCount; turn += 1) {
    history.push(makeMessage('user', `${blueprint.id}-user-${turn}`, 120 + (turn % 4) * 20));
    requests.push({
      elapsedMinutes: blueprint.elapsedMinutesForTurn(turn),
      messages: [fixedHead, blueprint.phaseForTurn(turn), blueprint.tailForTurn(turn), ...history],
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

// 27분 관측은 admission을 열지만, 바로 다음 29분 관측에서는 아직 살아 있는
// 30분 TTL 엔트리에 marker를 내지 않는다. 안전 여유 2분이 단순 보류가 아니라
// 직전 admitted write를 읽지 못하게 만드는 비대칭 손실인지 겨냥한다.
function createBoundaryJitterBaitScenario(): AdversarialV2Scenario {
  const id = 'adv2-boundary-jitter-bait';
  const phase = makeMessage('system', `${id}-phase`, PHASE_TOKENS);
  const tail = makeMessage('system', `${id}-fixed-tail`, FIXED_TAIL_TOKENS);
  return buildAppendScenario({
    attackSurface: '28분 admission 창과 30분 TTL 사이의 2분 사각지대',
    elapsedMinutesForTurn: (turn) => (turn === 1 ? 0 : turn % 2 === 0 ? 27 : 29),
    id,
    label: '동일 phase 재등장 간격 27분↔29분 jitter',
    phaseForTurn: () => phase,
    requestCount: 12,
    tailForTurn: () => tail,
  });
}

// 28분은 창 안이면서 TTL 안이다. 경계 공격이 실패한다면 매 재등장에서 직전
// frontier를 이어 읽어야 하므로, jitter 결과가 단순히 긴 요청 간격 탓인지
// 구분하는 양성 대조군으로 둔다.
function createBoundaryRefreshChainScenario(): AdversarialV2Scenario {
  const id = 'adv2-boundary-refresh-chain';
  const phase = makeMessage('system', `${id}-phase`, PHASE_TOKENS);
  const tail = makeMessage('system', `${id}-fixed-tail`, FIXED_TAIL_TOKENS);
  return buildAppendScenario({
    attackSurface: '28분 포함 경계에서 frontier read 연쇄가 끊기지 않는다는 가정',
    elapsedMinutesForTurn: (turn) => (turn === 1 ? 0 : 28),
    id,
    label: '동일 phase가 정확히 28분마다 재등장',
    phaseForTurn: () => phase,
    requestCount: 12,
    tailForTurn: () => tail,
  });
}

// 초반에는 tail이 안정돼 phase recurrence가 실제 깊은 히트를 예측하지만, 학습이
// 끝난 직후 tail이 매번 바뀐다. 한번 얻은 positive evidence를 suffix의 체제
// 전환 뒤에도 철회하지 않는 admission의 상태 전환 지연을 겨냥한다.
function createDwellToTailChurnScenario(): AdversarialV2Scenario {
  const id = 'adv2-dwell-to-tail-churn';
  const phase = makeMessage('system', `${id}-phase`, PHASE_TOKENS);
  const stableTail = makeMessage('system', `${id}-stable-tail`, LARGE_TAIL_TOKENS);
  return buildAppendScenario({
    attackSurface: 'phase 재등장 증거가 suffix 체제 전환 뒤에도 유효하다는 가정',
    elapsedMinutesForTurn: () => 2,
    id,
    label: '6요청 안정 tail 뒤 매요청 고유 tail churn',
    phaseForTurn: () => phase,
    requestCount: 36,
    tailForTurn: (turn) =>
      turn <= 6
        ? stableTail
        : makeMessage('system', `${id}-unique-tail-${turn}`, LARGE_TAIL_TOKENS),
  });
}

// phase identity가 보지 않는 tail도 실사용에서는 설정·로어북 갱신으로 가끔
// 바뀐다. 교체가 충분히 드물면 블라인드 스팟이 있어도 dwell read로 비용을
// 상쇄하는지 확인해, 모든 suffix 변경을 공격 성공으로 오인하지 않게 한다.
function createLowFrequencyTailReplacementScenario(): AdversarialV2Scenario {
  const id = 'adv2-low-frequency-tail-replacement';
  const phase = makeMessage('system', `${id}-phase`, PHASE_TOKENS);
  return buildAppendScenario({
    attackSurface: 'phase identity 밖 tail의 저빈도 비주기 교체',
    elapsedMinutesForTurn: () => 2,
    id,
    label: '8요청 dwell마다 tail 비주기 교체',
    phaseForTurn: () => phase,
    requestCount: 36,
    tailForTurn: (turn) =>
      makeMessage(
        'system',
        `${id}-tail-generation-${Math.floor((turn - 1) / 8)}`,
        FIXED_TAIL_TOKENS,
      ),
  });
}

// 긴 히스토리에서 저장한 frontier 숫자는 31분 뒤 짧은 히스토리에서는 guard로
// 숨겨진다. 하지만 그 짧은 관측이 admission을 다시 연 직후 더 긴 별도 lineage가
// 오면 같은 숫자가 유효 범위에 복귀해 전혀 다른 메시지를 가리킨다. 범위 검사만
// 으로 frontier의 내용 동일성까지 보장할 수 있다는 가정을 찌른다.
function createHistoryRebaseScenario(): AdversarialV2Scenario {
  const id = 'adv2-history-rebase';
  const fixedHead = makeMessage('system', `${id}-fixed-head`, FIXED_HEAD_TOKENS);
  const phase = makeMessage('system', `${id}-phase`, PHASE_TOKENS);
  const fixedTail = makeMessage('system', `${id}-fixed-tail`, FIXED_TAIL_TOKENS);
  const requests: ScenarioRequest[] = [];
  const initialHistory = Array.from({ length: 12 }, (_, historyIndex) =>
    makeMessage('user', `${id}-initial-history-${historyIndex}`, 240),
  );

  requests.push({
    elapsedMinutes: 0,
    messages: [fixedHead, phase, fixedTail, ...initialHistory],
  });
  requests.push({
    elapsedMinutes: 2,
    messages: [
      fixedHead,
      phase,
      fixedTail,
      ...initialHistory,
      makeMessage('user', `${id}-initial-extension-0`, 240),
      makeMessage('user', `${id}-initial-extension-1`, 240),
    ],
  });

  for (let cycle = 1; cycle <= 6; cycle += 1) {
    requests.push({
      elapsedMinutes: 31,
      messages: [
        fixedHead,
        phase,
        fixedTail,
        makeMessage('user', `${id}-short-lineage-${cycle}`, 240),
      ],
    });
    const rebasedHistory = Array.from({ length: 18 + cycle * 4 }, (_, historyIndex) =>
      makeMessage('user', `${id}-rebased-${cycle}-history-${historyIndex}`, 240),
    );
    requests.push({
      elapsedMinutes: 2,
      messages: [fixedHead, phase, fixedTail, ...rebasedHistory],
    });
  }

  return {
    attackSurface: '축소 뒤 재성장한 다른 lineage에서 frontier index를 내용 확인 없이 재사용',
    id,
    label: '31분 축소 관측 뒤 2분 내 더 긴 독립 히스토리로 rebase',
    requests,
  };
}

// hot phase 사이에 다시 오지 않을 phase를 계속 끼워 넣는다. observation과
// frontier map이 phase별로 정말 격리돼 있다면 one-off 상태는 shield에 머물고
// hot 상태의 recall만 유지돼야 하므로, 혼합 수명 분포의 상태 오염을 검사한다.
function createMixedPhaseLifetimeScenario(): AdversarialV2Scenario {
  const id = 'adv2-mixed-phase-lifetimes';
  const hotPhase = makeMessage('system', `${id}-hot-phase`, PHASE_TOKENS);
  const tail = makeMessage('system', `${id}-fixed-tail`, FIXED_TAIL_TOKENS);
  return buildAppendScenario({
    attackSurface: '재등장 phase와 일회성 phase가 admission 상태를 서로 오염시키지 않는다는 가정',
    elapsedMinutesForTurn: () => 2,
    id,
    label: 'hot phase와 매번 고유한 one-off phase 교차',
    phaseForTurn: (turn) =>
      turn % 2 === 1
        ? hotPhase
        : makeMessage('system', `${id}-one-off-phase-${turn}`, PHASE_TOKENS),
    requestCount: 36,
    tailForTurn: () => tail,
  });
}

export function createAdversarialV2Trajectories(): readonly AdversarialV2Scenario[] {
  return [
    createBoundaryJitterBaitScenario(),
    createBoundaryRefreshChainScenario(),
    createDwellToTailChurnScenario(),
    createLowFrequencyTailReplacementScenario(),
    createHistoryRebaseScenario(),
    createMixedPhaseLifetimeScenario(),
  ];
}
