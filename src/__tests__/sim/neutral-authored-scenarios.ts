/**
 * neutral-authored-scenarios.ts
 *
 * RisuAI 프롬프트 캐싱 정책 비교를 위한 중립 벤치마크 시나리오 집합.
 *
 * 설계 원칙 (블라인드 공정성):
 * - 비교 대상 캐싱 정책이 무엇인지 모른 상태로 작성했다. 특정 정책에 유리/불리한
 *   패턴을 의도적으로 넣거나 뺀 것은 없다.
 * - 목표는 "실사용 분포의 대표성"이다. 캐시 친화적 패턴(append·reroll)과 캐시
 *   적대적 패턴(조건부 로어 churn·CBS 매크로·그룹 카드 스왑·트림)을 실사용 빈도만큼
 *   자연스럽게 섞었다. 단일 패턴 극단화는 피했다.
 * - 완전 결정론: Math.random / Date.now 미사용. 모든 텍스트는 makeBlock 헬퍼로 생성.
 *
 * 캐시 계약(참고, 시나리오는 마커를 신경쓰지 않음):
 * - 프리픽스 exact match 시에만 read hit, 1024토큰(문자수/4) 미만 프리픽스는 캐시 불가.
 * - TTL 30분, read 시 갱신, 무접근 30분 경과 시 하드 만료.
 *
 * 규모 표기: 토큰 ≈ 문자수 / 4. request 총 텍스트를 8k~150k 토큰 범위로 유지.
 */

export interface NeutralMessage {
  role: 'system' | 'user' | 'assistant';
  text: string;
}

export interface NeutralRequest {
  /** 직전 요청으로부터의 경과 분. 첫 요청은 0 */
  elapsedMinutes: number;
  messages: NeutralMessage[];
}

export interface NeutralScenario {
  /** 'n01-...' 형식 */
  id: string;
  label: string;
  /** 실사용 빈도 가중치 0.5~3.0 (합산 점수 가중용) */
  weight: number;
  requests: NeutralRequest[];
}

/* ────────────────────────────── 결정론 텍스트 헬퍼 ────────────────────────────── */

const CHARS_PER_TOKEN = 4;

/**
 * label 문장을 반복해 정확히 `chars` 길이의 결정론적 블록을 만든다.
 * 같은 (label, chars) 입력은 항상 동일 문자열 → append/reroll의 exact match를 재현.
 */
function makeBlock(label: string, chars: number): string {
  if (chars <= 0) return '';
  const sentence = `[${label}] Representative RP prompt filler for the "${label}" segment, sized to model realistic token usage in a RisuAI request. `;
  const times = Math.ceil(chars / sentence.length);
  return sentence.repeat(times).slice(0, chars);
}

/** ktokens 는 킬로토큰 단위 (1.0 = 1000토큰 ≈ 4000자) */
function msg(role: NeutralMessage['role'], label: string, ktokens: number): NeutralMessage {
  const chars = Math.round(ktokens * 1000 * CHARS_PER_TOKEN);
  return { role, text: makeBlock(label, chars) };
}
const sys = (label: string, ktokens: number): NeutralMessage => msg('system', label, ktokens);
const usr = (label: string, ktokens: number): NeutralMessage => msg('user', label, ktokens);
const asst = (label: string, ktokens: number): NeutralMessage => msg('assistant', label, ktokens);

/* ────────────────────────────── 요청 조립 헬퍼 ────────────────────────────── */

interface Extras {
  /** 메모리 요약 system 블록 (히스토리 앞) */
  memory?: NeutralMessage;
  /** 조건부 로어북 system 블록들 (히스토리 앞) */
  conditional?: NeutralMessage[];
  /** depth 주입(작가노트/로어): 끝에서 N번째에 삽입 */
  depthNote?: NeutralMessage;
  depthFromEnd?: number;
}

/**
 * 요청 messages 조립: [lead..., memory?, conditional?..., history..., tail] 뒤
 * depthNote 를 끝에서 depthFromEnd 번째 위치에 삽입.
 */
function assemble(
  lead: NeutralMessage[],
  history: NeutralMessage[],
  tail: NeutralMessage,
  extras?: Extras,
): NeutralMessage[] {
  const msgs: NeutralMessage[] = [...lead];
  if (extras?.memory) msgs.push(extras.memory);
  if (extras?.conditional && extras.conditional.length) msgs.push(...extras.conditional);
  msgs.push(...history, tail);
  if (extras?.depthNote) {
    const n = Math.max(1, Math.min(extras.depthFromEnd ?? 2, msgs.length));
    msgs.splice(msgs.length - n, 0, extras.depthNote);
  }
  return msgs;
}

function req(elapsedMinutes: number, messages: NeutralMessage[]): NeutralRequest {
  return { elapsedMinutes, messages };
}

/**
 * 한 방(대화 세션)의 상태를 들고 다니는 경량 빌더.
 * - send: 현재 history + tail 로 요청 스냅샷을 만든다 (히스토리 객체 참조 재사용 → reroll/append exact match 재현)
 * - commit: tail 과 응답을 history 에 반영해 다음 턴으로 넘어간다
 * - leadOverride: 방 전환/그룹 카드 스왑 등 lead 가 바뀌는 경우
 */
function room(lead: NeutralMessage[]) {
  const history: NeutralMessage[] = [];
  const requests: NeutralRequest[] = [];
  return {
    history,
    requests,
    send(elapsed: number, tail: NeutralMessage, extras?: Extras, leadOverride?: NeutralMessage[]): void {
      requests.push(req(elapsed, assemble(leadOverride ?? lead, history, tail, extras)));
    },
    commit(tail: NeutralMessage, response: NeutralMessage): void {
      history.push(tail, response);
    },
  };
}

/* ────────────────────────────── 시나리오 빌더 ────────────────────────────── */

/**
 * n01 — 소형 캐주얼 append 세션 (small, 8k~14k)
 * 가장 흔한 일상 RP: 짧은 카드, 짧은 응답, 기본 append 흐름에 리롤 2회가 섞임.
 * weight 3.0 — 전체 사용에서 압도적으로 흔한 기본 패턴이라 최대 가중.
 */
function build_n01(): NeutralScenario {
  const lead = [
    sys('n01-main-prompt', 1.0),
    sys('n01-char-card', 5.6),
    sys('n01-persona', 0.6),
    sys('n01-always-lore', 1.2),
  ];
  const r = room(lead);

  const u1 = usr('n01-user-1', 0.2);
  r.send(0, u1); r.commit(u1, asst('n01-asst-1', 0.7));

  const u2 = usr('n01-user-2', 0.15);
  r.send(2.4, u2); r.send(0.5, u2); // 리롤 1회
  r.commit(u2, asst('n01-asst-2', 0.9));

  const u3 = usr('n01-user-3', 0.25);
  r.send(3.1, u3); r.commit(u3, asst('n01-asst-3', 0.5));

  const u4 = usr('n01-user-4', 0.2);
  r.send(1.8, u4); r.commit(u4, asst('n01-asst-4', 1.4));

  const u5 = usr('n01-user-5', 0.18);
  r.send(4.2, u5); r.send(0.6, u5); // 리롤 1회
  r.commit(u5, asst('n01-asst-5', 0.8));

  const u6 = usr('n01-user-6', 0.3);
  r.send(2.0, u6); r.commit(u6, asst('n01-asst-6', 1.1));

  return { id: 'n01-small-casual-append', label: '소형 캐주얼 append + 소량 리롤', weight: 3.0, requests: r.requests };
}

/**
 * n02 — 중형 append + 조건부 로어 소량 토글 (medium, ~26k~48k)
 * 중간 크기 카드 + 상시 로어. 대화 중 키워드로 조건부 로어 한두 개가 켜졌다 꺼짐.
 * weight 2.2 — 중형 RP는 매우 흔하며 조건부 로어 사용도 보편적.
 */
function build_n02(): NeutralScenario {
  const lead = [
    sys('n02-main-prompt', 1.5),
    sys('n02-char-card', 18),
    sys('n02-persona', 1.0),
    sys('n02-always-lore', 3.0),
  ];
  const loreA = sys('n02-cond-lore-A', 1.2);
  const loreB = sys('n02-cond-lore-B', 0.9);
  const r = room(lead);

  const u1 = usr('n02-user-1', 0.25);
  r.send(0, u1); r.commit(u1, asst('n02-asst-1', 1.2));

  const u2 = usr('n02-user-2', 0.3);
  r.send(3.5, u2, { conditional: [loreA] }); // 로어 A 활성
  r.commit(u2, asst('n02-asst-2', 1.6));

  const u3 = usr('n02-user-3', 0.2);
  r.send(2.1, u3, { conditional: [loreA] });
  r.commit(u3, asst('n02-asst-3', 0.9));

  const u4 = usr('n02-user-4', 0.35);
  r.send(5.0, u4, { conditional: [loreA, loreB] }); // B 추가 활성
  r.send(0.7, u4, { conditional: [loreA, loreB] }); // 리롤
  r.commit(u4, asst('n02-asst-4', 2.2));

  const u5 = usr('n02-user-5', 0.28);
  r.send(2.8, u5, { conditional: [loreB] }); // A 비활성, B만
  r.commit(u5, asst('n02-asst-5', 1.3));

  const u6 = usr('n02-user-6', 0.22);
  r.send(4.4, u6); // 조건부 로어 전부 꺼짐
  r.commit(u6, asst('n02-asst-6', 1.0));

  const u7 = usr('n02-user-7', 0.3);
  r.send(1.9, u7, { conditional: [loreA] });
  r.commit(u7, asst('n02-asst-7', 1.7));

  return { id: 'n02-medium-append-condlore', label: '중형 append + 조건부 로어 소량 토글', weight: 2.2, requests: r.requests };
}

/**
 * n03 — 리롤 버스트 세션 (small-medium, ~13k~22k)
 * append 사이사이 연속 리롤(2~4회)이 반복되는 헤비 리롤러. 리롤 간격은 짧다.
 * weight 2.5 — 리롤은 턴의 15~30%를 차지하며 연속 리롤도 흔하다.
 */
function build_n03(): NeutralScenario {
  const lead = [
    sys('n03-main-prompt', 1.2),
    sys('n03-char-card', 9.0),
    sys('n03-persona', 0.8),
    sys('n03-always-lore', 1.5),
  ];
  const r = room(lead);

  const u1 = usr('n03-user-1', 0.3);
  r.send(0, u1); r.commit(u1, asst('n03-asst-1', 1.0));

  const u2 = usr('n03-user-2', 0.25);
  r.send(2.6, u2);
  r.send(0.5, u2); r.send(0.4, u2); r.send(0.6, u2); // 연속 3회 리롤
  r.commit(u2, asst('n03-asst-2', 1.3));

  const u3 = usr('n03-user-3', 0.2);
  r.send(3.2, u3); r.commit(u3, asst('n03-asst-3', 0.8));

  const u4 = usr('n03-user-4', 0.28);
  r.send(1.7, u4);
  r.send(0.3, u4); r.send(0.5, u4); r.send(0.4, u4); r.send(0.6, u4); // 연속 4회 리롤
  r.commit(u4, asst('n03-asst-4', 1.5));

  return { id: 'n03-reroll-burst', label: '리롤 버스트(연속 리롤 다발)', weight: 2.5, requests: r.requests };
}

/**
 * n04 — 대형 캐릭터 카드 + 헤비 응답 (large, ~68k~105k)
 * 55k 규모 대형 카드에 상시 로어까지. 헤비 유저라 응답이 3~7k. append + 리롤.
 * weight 1.5 — 대형 카드/헤비 응답 세션은 흔하지만 소형보다는 적다.
 */
function build_n04(): NeutralScenario {
  const lead = [
    sys('n04-main-prompt', 2.0),
    sys('n04-char-card', 55),
    sys('n04-persona', 1.2),
    sys('n04-always-lore', 9.0),
  ];
  const r = room(lead);

  const u1 = usr('n04-user-1', 0.4);
  r.send(0, u1); r.commit(u1, asst('n04-asst-1', 5.0));

  const u2 = usr('n04-user-2', 0.5);
  r.send(4.0, u2); r.commit(u2, asst('n04-asst-2', 6.0));

  const u3 = usr('n04-user-3', 0.3);
  r.send(3.3, u3); r.send(0.8, u3); // 리롤
  r.commit(u3, asst('n04-asst-3', 3.5));

  const u4 = usr('n04-user-4', 0.45);
  r.send(6.0, u4); r.commit(u4, asst('n04-asst-4', 6.5));

  const u5 = usr('n04-user-5', 0.35);
  r.send(2.5, u5); r.commit(u5, asst('n04-asst-5', 5.0));

  const u6 = usr('n04-user-6', 0.4);
  r.send(3.8, u6); r.commit(u6, asst('n04-asst-6', 7.0));

  return { id: 'n04-large-charcard', label: '대형 카드 + 헤비 응답 append/리롤', weight: 1.5, requests: r.requests };
}

/**
 * n05 — 메모리 요약 시스템 세션 (medium, ~24k~46k)
 * 오래된 대화를 요약한 system 블록이 히스토리 앞에 삽입되고 ~6턴마다 갱신되며,
 * 갱신 시 가장 오래된 원문 턴 일부가 요약으로 대체(트림)된다.
 * weight 1.3 — 메모리 시스템은 일부 유저만 쓰지만 장기 세션에서 꾸준히 등장.
 */
function build_n05(): NeutralScenario {
  const lead = [
    sys('n05-main-prompt', 1.5),
    sys('n05-char-card', 15),
    sys('n05-persona', 1.0),
    sys('n05-always-lore', 2.5),
  ];
  const r = room(lead);
  let memory: NeutralMessage | undefined;

  const turn = (i: number, elapsed: number, uTok: number, aTok: number): void => {
    const u = usr(`n05-user-${i}`, uTok);
    r.send(elapsed, u, memory ? { memory } : undefined);
    r.commit(u, asst(`n05-asst-${i}`, aTok));
  };

  turn(1, 0, 0.3, 1.4);
  turn(2, 3.0, 0.25, 1.6);
  turn(3, 2.4, 0.35, 1.2);
  // 요약 최초 생성(v1) + 가장 오래된 2턴(4개 메시지) 요약으로 대체
  memory = sys('n05-memory-summary-v1', 2.2);
  r.history.splice(0, 4);
  turn(4, 4.1, 0.3, 1.5);
  turn(5, 2.0, 0.2, 1.8);
  turn(6, 3.6, 0.28, 1.3);
  // 요약 갱신(v2) + 추가 트림
  memory = sys('n05-memory-summary-v2', 2.8);
  r.history.splice(0, 4);
  turn(7, 5.0, 0.32, 1.6);
  turn(8, 2.7, 0.24, 1.1);
  turn(9, 3.1, 0.3, 1.7);
  turn(10, 12.0, 0.26, 1.4); // 딴짓 후 복귀(8~25분대)

  return { id: 'n05-memory-summary', label: '메모리 요약 갱신 + 원문 트림', weight: 1.3, requests: r.requests };
}

/**
 * n06 — 조건부 로어 churn (medium, ~28k~44k)
 * 키워드 트리거 로어 블록들이 턴마다 조합이 바뀐다(선두 근처가 매 턴 변동).
 * 캐시 적대적이지만 로어 헤비 카드에서 실제로 자주 일어난다. append/리롤 혼합.
 * weight 1.6 — 로어북 활용 카드가 흔하고 조합 변동도 실사용에서 자연 발생.
 */
function build_n06(): NeutralScenario {
  const lead = [
    sys('n06-main-prompt', 1.6),
    sys('n06-char-card', 16),
    sys('n06-persona', 1.0),
    sys('n06-always-lore', 2.0),
  ];
  const A = sys('n06-cond-A', 1.1);
  const B = sys('n06-cond-B', 0.8);
  const C = sys('n06-cond-C', 1.4);
  const D = sys('n06-cond-D', 0.6);
  // 턴마다 활성 조합이 달라짐
  const combos: NeutralMessage[][] = [
    [A],
    [A, B],
    [B, C],
    [A, C, D],
    [C],
    [A, D],
    [B, C, D],
    [A, B],
  ];
  const r = room(lead);

  combos.forEach((cond, idx) => {
    const i = idx + 1;
    const u = usr(`n06-user-${i}`, 0.25 + (idx % 3) * 0.05);
    const elapsed = idx === 0 ? 0 : 2.0 + (idx % 4);
    r.send(elapsed, u, { conditional: cond });
    if (idx === 3) r.send(0.6, u, { conditional: cond }); // 한 번 리롤(같은 조합)
    r.commit(u, asst(`n06-asst-${i}`, 1.2 + (idx % 3) * 0.4));
  });

  return { id: 'n06-conditional-lore-churn', label: '조건부 로어 조합 변동(선두 churn)', weight: 1.6, requests: r.requests };
}

/**
 * n07 — depth 주입(작가노트) 세션 (medium, ~26k~50k)
 * 작가노트/일부 로어가 "끝에서 2번째"에 삽입되어 매 턴 뒤로 밀린다. append + 리롤.
 * weight 2.0 — 작가노트/depth 주입은 폭넓게 쓰이는 보편 기능.
 */
function build_n07(): NeutralScenario {
  const lead = [
    sys('n07-main-prompt', 1.4),
    sys('n07-char-card', 17),
    sys('n07-persona', 1.0),
    sys('n07-always-lore', 2.5),
  ];
  const authorNote = sys('n07-author-note', 0.9); // 내용은 안정적, 위치만 매 턴 이동
  const r = room(lead);

  const turn = (i: number, elapsed: number, aTok: number, reroll = false): void => {
    const u = usr(`n07-user-${i}`, 0.28);
    const extras: Extras = { depthNote: authorNote, depthFromEnd: 2 };
    r.send(elapsed, u, extras);
    if (reroll) r.send(0.5, u, extras);
    r.commit(u, asst(`n07-asst-${i}`, aTok));
  };

  turn(1, 0, 1.5);
  turn(2, 3.2, 2.0);
  turn(3, 2.5, 1.2, true);
  turn(4, 4.0, 2.4);
  turn(5, 1.8, 1.6);
  turn(6, 3.7, 2.1, true);
  turn(7, 2.9, 1.3);

  return { id: 'n07-depth-authornote', label: 'depth 작가노트(끝에서 N번째) 매턴 이동', weight: 2.0, requests: r.requests };
}

/**
 * n08 — 장기 세션 컨텍스트 트림 (large, ~80k~140k)
 * 대형 카드 + 헤비 응답으로 예산을 넘기면 오래된 히스토리부터 잘려나간다.
 * weight 1.5 — 긴 세션에서 트림은 필연적으로 발생.
 */
function build_n08(): NeutralScenario {
  const lead = [
    sys('n08-main-prompt', 2.0),
    sys('n08-char-card', 42),
    sys('n08-persona', 1.2),
    sys('n08-always-lore', 8.0),
  ];
  const r = room(lead);

  const turn = (i: number, elapsed: number, aTok: number, reroll = false): void => {
    const u = usr(`n08-user-${i}`, 0.4);
    r.send(elapsed, u);
    if (reroll) r.send(0.7, u);
    r.commit(u, asst(`n08-asst-${i}`, aTok));
    // 예산 초과 모사: 히스토리가 길어지면 가장 오래된 2턴 트림
    if (r.history.length > 12) r.history.splice(0, 4);
  };

  turn(1, 0, 4.0);
  turn(2, 3.5, 5.0);
  turn(3, 2.8, 3.5, true);
  turn(4, 4.2, 6.0);
  turn(5, 2.1, 4.5);
  turn(6, 3.9, 5.5); // 이후부터 트림 발생
  turn(7, 2.6, 4.0);
  turn(8, 5.0, 6.0, true);
  turn(9, 3.3, 3.8);
  turn(10, 2.4, 5.2);

  return { id: 'n08-context-trim-long', label: '장기 세션 오래된 히스토리 트림', weight: 1.5, requests: r.requests };
}

/**
 * n09 — 방 전환 왕복 + 장기 이탈 (mixed medium, ~11k~26k)
 * 캐릭터 방 A→B 이동(프리픽스 통째 변경) 후 TTL 안에 A로 복귀(원 프리픽스 재개),
 * 마지막엔 30분 초과 이탈로 TTL 만료.
 * weight 1.4 — 방 이동/왕복은 흔한 행동.
 */
function build_n09(): NeutralScenario {
  const leadA = [
    sys('n09-main-prompt', 1.2),
    sys('n09-charA-card', 10),
    sys('n09-persona', 0.8),
    sys('n09-loreA', 1.5),
  ];
  const leadB = [
    sys('n09-main-prompt', 1.2),
    sys('n09-charB-card', 8),
    sys('n09-persona', 0.8),
    sys('n09-loreB', 1.2),
  ];
  const historyA: NeutralMessage[] = [];
  const historyB: NeutralMessage[] = [];
  const requests: NeutralRequest[] = [];

  const sendA = (elapsed: number, u: NeutralMessage) =>
    requests.push(req(elapsed, assemble(leadA, historyA, u)));
  const sendB = (elapsed: number, u: NeutralMessage) =>
    requests.push(req(elapsed, assemble(leadB, historyB, u)));

  // 방 A
  const a1 = usr('n09-a-1', 0.3); sendA(0, a1); historyA.push(a1, asst('n09-a-1r', 1.2));
  const a2 = usr('n09-a-2', 0.25); sendA(3.0, a2); historyA.push(a2, asst('n09-a-2r', 1.5));
  const a3 = usr('n09-a-3', 0.3); sendA(2.2, a3); historyA.push(a3, asst('n09-a-3r', 1.1));

  // 방 B 로 전환 (프리픽스 통째 교체)
  const b1 = usr('n09-b-1', 0.3); sendB(1.5, b1); historyB.push(b1, asst('n09-b-1r', 1.3));
  const b2 = usr('n09-b-2', 0.28);
  sendB(2.8, b2); sendB(0.5, b2); // B 에서 리롤
  historyB.push(b2, asst('n09-b-2r', 1.4));

  // 방 A 로 복귀 (TTL 내, 원 프리픽스 재개)
  const a4 = usr('n09-a-4', 0.3); sendA(1.2, a4); historyA.push(a4, asst('n09-a-4r', 1.2));
  const a5 = usr('n09-a-5', 0.26); sendA(4.0, a5); historyA.push(a5, asst('n09-a-5r', 1.6));

  // 장기 이탈 후 복귀 (30분 초과 → TTL 만료)
  const a6 = usr('n09-a-6', 0.3); sendA(35.0, a6); historyA.push(a6, asst('n09-a-6r', 1.3));

  return { id: 'n09-room-switch-roundtrip', label: '방 전환 왕복 + 장기 이탈(TTL 만료)', weight: 1.4, requests };
}

/**
 * n10 — 그룹 채팅 (medium, ~24k~40k)
 * 응답자마다 캐릭터 설명 블록이 교체된다(선두 근처가 매 턴 바뀜). 히스토리는 누적.
 * weight 1.0 — 그룹 채팅은 뚜렷한 하위 사용층.
 */
function build_n10(): NeutralScenario {
  const mainP = sys('n10-main-prompt', 1.4);
  const persona = sys('n10-persona', 0.8);
  const groupLore = sys('n10-group-lore', 2.5);
  const cards: Record<'A' | 'B' | 'C', NeutralMessage> = {
    A: sys('n10-card-A', 6.0),
    B: sys('n10-card-B', 5.5),
    C: sys('n10-card-C', 6.5),
  };
  const leadFor = (who: 'A' | 'B' | 'C'): NeutralMessage[] => [mainP, cards[who], persona, groupLore];

  const history: NeutralMessage[] = [];
  const requests: NeutralRequest[] = [];
  const order: Array<'A' | 'B' | 'C'> = ['A', 'B', 'C', 'A', 'B', 'C', 'A', 'B', 'C'];

  order.forEach((who, idx) => {
    const i = idx + 1;
    const u = usr(`n10-turn-${i}`, 0.22);
    const elapsed = idx === 0 ? 0 : 1.0 + (idx % 3);
    requests.push(req(elapsed, assemble(leadFor(who), history, u)));
    if (idx === 4) {
      // 같은 응답자 카드로 리롤
      requests.push(req(0.5, assemble(leadFor(who), history, u)));
    }
    history.push(u, asst(`n10-resp-${i}-${who}`, 1.1 + (idx % 3) * 0.5));
  });

  return { id: 'n10-group-chat', label: '그룹 채팅 응답자 카드 스왑(선두 변동)', weight: 1.0, requests };
}

/**
 * n11 — CBS 매크로 가변 카드 (small-medium, ~14k~24k)
 * {{random}}/시간 표시 등으로 system 일부가 매 요청 가변(리롤 포함 재평가).
 * 전체 카드의 10~20%에 해당. append/리롤 혼합.
 * weight 1.0 — 소수 카드지만 실사용에서 규칙적으로 등장.
 */
function build_n11(): NeutralScenario {
  const mainP = sys('n11-main-prompt', 1.2);
  const card = sys('n11-char-card', 9.0);
  const persona = sys('n11-persona', 0.7);
  const alwaysLore = sys('n11-always-lore', 1.5);
  // 요청 인덱스마다 달라지는 매크로 블록(리롤도 재평가되어 달라짐)
  const macro = (reqIndex: number): NeutralMessage => sys(`n11-cbs-macro-r${reqIndex}`, 0.3);
  const leadFor = (reqIndex: number): NeutralMessage[] => [mainP, card, persona, macro(reqIndex), alwaysLore];

  const history: NeutralMessage[] = [];
  const requests: NeutralRequest[] = [];
  let reqIndex = 0;
  const send = (elapsed: number, tail: NeutralMessage): void => {
    requests.push(req(elapsed, assemble(leadFor(reqIndex), history, tail)));
    reqIndex += 1;
  };

  const u1 = usr('n11-user-1', 0.25); send(0, u1); history.push(u1, asst('n11-asst-1', 1.0));
  const u2 = usr('n11-user-2', 0.3); send(3.0, u2); history.push(u2, asst('n11-asst-2', 1.4));
  const u3 = usr('n11-user-3', 0.22);
  send(2.4, u3); send(0.6, u3); // 리롤(매크로 재평가로 프리픽스 달라짐)
  history.push(u3, asst('n11-asst-3', 0.9));
  const u4 = usr('n11-user-4', 0.28); send(4.1, u4); history.push(u4, asst('n11-asst-4', 1.6));
  const u5 = usr('n11-user-5', 0.26); send(2.0, u5); history.push(u5, asst('n11-asst-5', 1.1));
  const u6 = usr('n11-user-6', 0.24); send(3.3, u6); history.push(u6, asst('n11-asst-6', 1.3));

  return { id: 'n11-cbs-macro-variable', label: 'CBS 매크로 매요청 가변 system', weight: 1.0, requests };
}

/**
 * n12 — 중간 수정/롤백 + 장기 이탈 (medium-large, ~40k~78k)
 * 과거 메시지 제자리 수정, 몇 턴 되돌려 삭제 후 재진행, 그리고 30분 초과 이탈.
 * weight 1.0 — 자주는 아니지만 실사용에서 분명히 나타나는 편집/되감기 행동.
 */
function build_n12(): NeutralScenario {
  const lead = [
    sys('n12-main-prompt', 1.8),
    sys('n12-char-card', 22),
    sys('n12-persona', 1.0),
    sys('n12-always-lore', 3.5),
  ];
  const r = room(lead);

  const u1 = usr('n12-user-1', 0.35); r.send(0, u1); r.commit(u1, asst('n12-asst-1', 2.0));
  const u2 = usr('n12-user-2', 0.3); r.send(3.4, u2); r.commit(u2, asst('n12-asst-2', 2.6));
  const u3 = usr('n12-user-3', 0.28); r.send(2.7, u3); r.commit(u3, asst('n12-asst-3', 1.8));

  // 중간 수정: 2턴 전 assistant 응답을 제자리 수정 (history[3] 교체 → 그 뒤 프리픽스 붕괴)
  r.history[3] = asst('n12-asst-2-edited', 2.4);
  const u4 = usr('n12-user-4', 0.32); r.send(6.0, u4); r.commit(u4, asst('n12-asst-4', 2.2));

  // 롤백: 최근 2턴(4개 메시지) 삭제 후 다른 방향으로 재진행
  r.history.splice(r.history.length - 4, 4);
  const u5 = usr('n12-user-5-branch', 0.3);
  r.send(2.2, u5); r.send(0.6, u5); // 새 분기에서 리롤
  r.commit(u5, asst('n12-asst-5', 2.8));

  const u6 = usr('n12-user-6', 0.34); r.send(4.5, u6); r.commit(u6, asst('n12-asst-6', 2.1));

  // 장기 이탈 후 복귀 (TTL 만료)
  const u7 = usr('n12-user-7', 0.3); r.send(42.0, u7); r.commit(u7, asst('n12-asst-7', 2.3));

  return { id: 'n12-mid-edit-rollback', label: '중간 수정/롤백 재진행 + 장기 이탈', weight: 1.0, requests: r.requests };
}

/* ────────────────────────────── export ────────────────────────────── */

export const neutralScenarios: NeutralScenario[] = [
  build_n01(),
  build_n02(),
  build_n03(),
  build_n04(),
  build_n05(),
  build_n06(),
  build_n07(),
  build_n08(),
  build_n09(),
  build_n10(),
  build_n11(),
  build_n12(),
];
