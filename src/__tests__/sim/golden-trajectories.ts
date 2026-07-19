import type { LlmMessage, LlmMessageRole } from 'llm-io';
import type { GoldenTrajectory, TrajectoryRequest } from './replay';

function makeMessage(role: LlmMessageRole, text: string): LlmMessage {
  return { role, content: [{ type: 'text', text }] };
}

function makeBlock(label: string, characters: number): string {
  const sentence = `[${label}] Stable offline simulation text records maps, routes, archive shelves, weather notes, and numbered observations. `;
  return sentence.repeat(Math.ceil(characters / sentence.length)).slice(0, characters);
}

function request(messages: readonly LlmMessage[], elapsedMinutes = 1): TrajectoryRequest {
  return { elapsedMinutes, messages: [...messages] };
}

function createAppendOnlyTrajectory(): GoldenTrajectory {
  const messages: LlmMessage[] = [
    makeMessage('system', makeBlock('append-system', 6_000)),
    makeMessage('user', makeBlock('append-user-1', 700)),
  ];
  const requests = [request(messages, 0)];
  for (let turn = 2; turn <= 7; turn += 1) {
    messages.push(
      makeMessage('assistant', makeBlock(`append-assistant-${turn - 1}`, 900)),
      makeMessage('user', makeBlock(`append-user-${turn}`, 700)),
    );
    requests.push(request(messages));
  }
  return {
    id: '01-append',
    label: 'append-only growth',
    requests,
  };
}

function createLeadingCbsTrapTrajectory(): GoldenTrajectory {
  const stableLead = makeMessage('system', makeBlock('cbs-stable-lead', 400));
  const stableLargeCard = makeMessage('system', makeBlock('cbs-large-card', 6_000));
  const stableUser = makeMessage('user', 'CBS trap user input remains unchanged.');
  const requests = Array.from({ length: 7 }, (_, turn) =>
    request(
      [
        stableLead,
        makeMessage('system', makeBlock(`cbs-random-${turn}`, 1_200)),
        stableLargeCard,
        stableUser,
      ],
      turn === 0 ? 0 : 1,
    ),
  );
  return {
    id: '02-cbs-trap',
    label: 'leading volatile CBS 1024 trap',
    requests,
  };
}

function createReverseDepthTrajectory(): GoldenTrajectory {
  const system = makeMessage('system', makeBlock('reverse-depth-system', 7_000));
  const lore = makeMessage('system', makeBlock('reverse-depth-lore', 1_800));
  const chat: LlmMessage[] = [makeMessage('user', makeBlock('reverse-user-1', 700))];
  const requests: TrajectoryRequest[] = [];
  for (let turn = 1; turn <= 6; turn += 1) {
    if (turn > 1) {
      chat.push(
        makeMessage('assistant', makeBlock(`reverse-assistant-${turn - 1}`, 800)),
        makeMessage('user', makeBlock(`reverse-user-${turn}`, 700)),
      );
    }
    const insertionIndex = Math.max(1, chat.length - 2);
    requests.push(
      request(
        [system, ...chat.slice(0, insertionIndex), lore, ...chat.slice(insertionIndex)],
        turn === 1 ? 0 : 1,
      ),
    );
  }
  return {
    id: '03-reverse-depth',
    label: 'reverse_depth moving lore block',
    requests,
  };
}

function createRerollTrajectory(): GoldenTrajectory {
  const system = makeMessage('system', makeBlock('reroll-system', 7_000));
  const setup = makeMessage('user', makeBlock('reroll-setup', 900));
  const trailingUser = makeMessage('user', 'Continue from the rerolled answer.');
  const requests = Array.from({ length: 6 }, (_, reroll) =>
    request(
      [
        system,
        setup,
        makeMessage('assistant', makeBlock(`reroll-random-${reroll}`, 1_000)),
        trailingUser,
      ],
      reroll === 0 ? 0 : 1,
    ),
  );
  return {
    id: '04-reroll',
    label: 'same-length nondeterministic reroll tail',
    requests,
  };
}

function createLoreToggleTrajectory(): GoldenTrajectory {
  const system = makeMessage('system', makeBlock('lore-toggle-system', 9_000));
  const stableUser = makeMessage('user', 'Lore budget competition input.');
  const loreA = makeMessage('system', makeBlock('lore-budget-A', 2_200));
  const loreB = makeMessage('system', makeBlock('lore-budget-B', 2_200));
  return {
    id: '05-lore-toggle',
    label: 'lore +A/-B budget competition',
    requests: [
      request([system, stableUser], 0),
      request([system, loreB, stableUser]),
      request([system, loreA, stableUser]),
      request([system, stableUser]),
      request([system, loreB, stableUser]),
      request([system, loreA, stableUser]),
    ],
  };
}

function createContextTrimmingTrajectory(): GoldenTrajectory {
  const system = makeMessage('system', makeBlock('trim-system', 8_000));
  const chat: LlmMessage[] = [makeMessage('user', makeBlock('trim-user-1', 700))];
  const requests: TrajectoryRequest[] = [request([system, ...chat], 0)];
  for (let turn = 2; turn <= 6; turn += 1) {
    chat.push(
      makeMessage('assistant', makeBlock(`trim-assistant-${turn - 1}`, 850)),
      makeMessage('user', makeBlock(`trim-user-${turn}`, 700)),
    );
    requests.push(request([system, ...chat]));
  }
  requests.push(request([system, ...chat.slice(4)]));
  requests.push(request([system, ...chat.slice(8)]));
  return {
    id: '06-context-trim',
    label: 'multi-message context trimming',
    requests,
  };
}

function createHypaSummaryTrajectory(): GoldenTrajectory {
  const system = makeMessage('system', makeBlock('hypa-system', 9_000));
  const stableRecentChat = [
    makeMessage('user', makeBlock('hypa-recent-user', 700)),
    makeMessage('assistant', makeBlock('hypa-recent-assistant', 800)),
    makeMessage('user', 'Current input after Hypa summary.'),
  ];
  const oldChat = [
    makeMessage('user', makeBlock('hypa-old-user', 1_000)),
    makeMessage('assistant', makeBlock('hypa-old-assistant', 1_000)),
  ];
  const requests: TrajectoryRequest[] = [
    request([system, makeMessage('user', 'Hypa bootstrap input.')], 0),
    request([system, ...oldChat, ...stableRecentChat]),
  ];
  for (let selection = 1; selection <= 5; selection += 1) {
    requests.push(
      request([
        system,
        makeMessage('system', makeBlock(`hypa-summary-selection-${selection}`, 2_600)),
        ...stableRecentChat,
      ]),
    );
  }
  return {
    id: '07-hypa-summary',
    label: 'Hypa replacement and fixed-phase reselection',
    requests,
  };
}

function createLuaPostEditTrajectory(): GoldenTrajectory {
  const system = makeMessage('system', makeBlock('lua-system', 7_500));
  const stableUser = makeMessage('user', makeBlock('lua-stable-user', 900));
  const finalUser = makeMessage('user', 'Input following the post-edited assistant.');
  const stableAssistantBody = makeBlock('lua-assistant-stable-body', 1_400);
  const requests = Array.from({ length: 7 }, (_, turn) =>
    request(
      [
        system,
        stableUser,
        makeMessage(
          'assistant',
          `${stableAssistantBody}${makeBlock(`lua-post-edit-tail-${turn}`, 120)}`,
        ),
        finalUser,
      ],
      turn === 0 ? 0 : 1,
    ),
  );
  return {
    id: '08-lua-post-edit',
    label: 'volatile assistant tail post_edit',
    requests,
  };
}

function createRoomSwitchTrajectory(): GoldenTrajectory {
  const sharedGlobal = makeMessage('system', makeBlock('shared-global-prefix', 5_500));
  return {
    id: '09-room-switch',
    label: 'full and partial-prefix room switches',
    requests: [
      request(
        [
          makeMessage('system', makeBlock('room-A-exclusive', 7_000)),
          makeMessage('user', 'Room A input.'),
        ],
        0,
      ),
      request([
        sharedGlobal,
        makeMessage('system', makeBlock('room-B-exclusive', 3_000)),
        makeMessage('user', 'Shared-room input.'),
      ]),
      request([
        sharedGlobal,
        makeMessage('system', makeBlock('room-C-exclusive', 3_000)),
        makeMessage('user', 'Shared-room input.'),
      ]),
    ],
  };
}

function createTtlGapTrajectory(): GoldenTrajectory {
  const messages = [
    makeMessage('system', makeBlock('ttl-system', 6_500)),
    makeMessage('user', 'TTL gap input.'),
  ];
  return {
    id: '10-ttl-gap',
    label: '31m and 61m request gaps',
    requests: [request(messages, 0), request(messages, 31), request(messages, 61)],
  };
}

function createChurnThenStableTrajectory(): GoldenTrajectory {
  const system = makeMessage('system', makeBlock('churn-stable-system', 8_000));
  const chat: LlmMessage[] = [makeMessage('user', makeBlock('churn-stable-user-1', 1_000))];
  const requests: TrajectoryRequest[] = [request([system, ...chat], 0)];
  for (let turn = 2; turn <= 3; turn += 1) {
    chat.push(
      makeMessage('assistant', makeBlock(`churn-stable-assistant-${turn - 1}`, 1_400)),
      makeMessage('user', makeBlock(`churn-stable-user-${turn}`, 1_000)),
    );
    requests.push(request([system, ...chat]));
  }

  const firstChurn = makeMessage('system', makeBlock('churn-stable-frontier-A', 6_000));
  const stableFrontier = makeMessage('system', makeBlock('churn-stable-frontier-B', 6_000));
  requests.push(
    request([system, firstChurn, ...chat]),
    request([system, stableFrontier, ...chat]),
    request([system, stableFrontier, ...chat]),
  );

  for (let turn = 4; turn <= 7; turn += 1) {
    chat.push(
      makeMessage('assistant', makeBlock(`churn-stable-assistant-${turn - 1}`, 1_400)),
      makeMessage('user', makeBlock(`churn-stable-user-${turn}`, 1_000)),
    );
    requests.push(request([system, stableFrontier, ...chat]));
  }

  return {
    id: '11-churn-then-stable',
    label: 'two frontier deaths followed by stable append',
    requests,
  };
}

function createChurnOscillatingTrajectory(): GoldenTrajectory {
  const system = makeMessage('system', makeBlock('churn-cycle-system', 8_000));
  const chat: LlmMessage[] = [makeMessage('user', makeBlock('churn-cycle-user-1', 1_000))];
  const requests: TrajectoryRequest[] = [request([system, ...chat], 0)];
  chat.push(
    makeMessage('assistant', makeBlock('churn-cycle-assistant-1', 1_400)),
    makeMessage('user', makeBlock('churn-cycle-user-2', 1_000)),
  );
  requests.push(request([system, ...chat]));

  for (let cycle = 1; cycle <= 3; cycle += 1) {
    const firstChurn = makeMessage('system', makeBlock(`churn-cycle-${cycle}-frontier-A`, 6_000));
    const stableFrontier = makeMessage(
      'system',
      makeBlock(`churn-cycle-${cycle}-frontier-B`, 6_000),
    );
    requests.push(
      request([system, firstChurn, ...chat]),
      request([system, stableFrontier, ...chat]),
      request([system, stableFrontier, ...chat]),
    );
  }

  return {
    id: '12-churn-oscillating',
    label: 'repeated two-death and one-stable cycles',
    requests,
  };
}

// 상태 매개 휘발 재현: 변이를 누적 적용해 인접 요청 간 정확히 한 지점의 두
// 글자만 달라지게 한다(실측: 23.5k자 요약 블록이 전이마다 1~2자, 오프셋은 매번
// 다름). base 기준 단발 치환은 이전 위치 복원 + 새 위치 변경으로 4자가 달라져
// 실측과 어긋난다. mutationCount 0은 원본 그대로라 블록 선두도 보존된다.
function mutateBlock(base: string, mutationCount: number): string {
  let text = base;
  for (let mutation = 1; mutation <= mutationCount; mutation += 1) {
    const offset = (mutation * 7_919) % (text.length - 2);
    text = `${text.slice(0, offset)}${String(mutation % 100).padStart(2, '0')}${text.slice(offset + 2)}`;
  }
  return text;
}

// 컨텍스트 스케일 프로필. characters/4 = 시뮬 토큰이며, 한국어 실프롬프트의
// 실토큰은 추정치의 약 1.4배(실측 58.7k est ↔ 82.8k real)이므로 30k/80k/120k는
// 실토큰 기준 어림값이다. 30k/80k/120k는 실사용 배분을 따라 로어북·장기기억
// (하이파 할당)을 함께 스케일한 "워크로드" 축이고, hist-*는 고정 블록을 80k
// 값으로 둔 채 히스토리 턴수만 바꾼 "컨텍스트 크기 단독" 축이다.
interface ManualSummaryScale {
  id: string;
  initialTurns: number;
  lorebookCharacters: number;
  memoryCharacters: number;
  summaryCharacters: number;
  // 전이 t(요청 t-1→t)가 t % period === 1이면 요약을 유지한다. 실측 mask는
  // [유지, 변동, 변동]의 반복(period 3). 미지정이면 매 전이 변동(worst case).
  stableSummaryPeriod?: number;
}

const MANUAL_SUMMARY_SCALES: readonly ManualSummaryScale[] = [
  {
    id: '30k',
    initialTurns: 2,
    lorebookCharacters: 2_000,
    memoryCharacters: 2_400,
    summaryCharacters: 8_000,
  },
  {
    id: '80k',
    initialTurns: 28,
    lorebookCharacters: 8_000,
    memoryCharacters: 15_200,
    summaryCharacters: 34_400,
  },
  {
    id: '120k',
    initialTurns: 44,
    lorebookCharacters: 16_000,
    memoryCharacters: 24_000,
    summaryCharacters: 48_000,
  },
  {
    id: '80k-mixed',
    initialTurns: 28,
    lorebookCharacters: 8_000,
    memoryCharacters: 15_200,
    summaryCharacters: 34_400,
    stableSummaryPeriod: 3,
  },
  {
    id: 'hist-2t',
    initialTurns: 2,
    lorebookCharacters: 8_000,
    memoryCharacters: 15_200,
    summaryCharacters: 34_400,
  },
  {
    id: 'hist-44t',
    initialTurns: 44,
    lorebookCharacters: 8_000,
    memoryCharacters: 15_200,
    summaryCharacters: 34_400,
  },
];

// 2026-07 실측 적자 사건의 박제. 프리셋 스크립트가 매턴 currentChat.State에
// 쓰는 수동 요약을 {{dictelement::...}}로 렌더링해, 요약 블록이 매턴 미세
// 변동한다. 07과 달리 요약이 채팅을 대체하지 않고 전체 히스토리 '앞'에 얹히는
// 추가형 구조라, 얕은 앵커 히트만 남고 요약 뒤 히스토리가 매턴 재쓰기된다.
// 블록 비율은 실측 4요청 구조(80k 프로필)를 따르고, 스케일별 손익 비교를 위해
// 히스토리·로어북·장기기억만 프로필로 바꾼다.
function createManualSummaryAdditiveTrajectory(scale: ManualSummaryScale): GoldenTrajectory {
  const recentWindowTurns = 5;
  const totalRequests = 8;
  const memoryAppearsAtRequest = 2;
  const prefix = `mas-${scale.id}`;

  const lorebookNoteCharacters = scale.lorebookCharacters / 5;
  const head = [
    makeMessage('system', makeBlock(`${prefix}-head-main`, 8_000)),
    makeMessage('user', makeBlock(`${prefix}-lore-note-1`, lorebookNoteCharacters)),
    makeMessage('user', makeBlock(`${prefix}-lore-note-2`, lorebookNoteCharacters)),
    makeMessage('user', makeBlock(`${prefix}-lore-note-3`, lorebookNoteCharacters)),
    makeMessage('user', makeBlock(`${prefix}-lore-note-4`, lorebookNoteCharacters)),
    makeMessage('user', makeBlock(`${prefix}-lore-note-5`, lorebookNoteCharacters)),
    makeMessage('system', makeBlock(`${prefix}-head-rule-1`, 2_800)),
    makeMessage('system', makeBlock(`${prefix}-head-rule-2`, 2_200)),
    makeMessage('user', makeBlock(`${prefix}-head-persona`, 2_000)),
  ];
  const longTermMemory = makeMessage(
    'user',
    makeBlock(`${prefix}-long-term-memory`, scale.memoryCharacters),
  );
  const summaryBase = makeBlock(`${prefix}-manual-summary`, scale.summaryCharacters);
  const midFixedNotes = [
    makeMessage('user', makeBlock(`${prefix}-mid-note-a`, 1_100)),
    makeMessage('user', makeBlock(`${prefix}-mid-note-b`, 100)),
  ];
  const tailSystems = [4_400, 3_900, 430, 1_400, 3_900].map((characters, index) =>
    makeMessage('system', makeBlock(`${prefix}-tail-system-${index + 1}`, characters)),
  );
  const tailNote = makeMessage('user', makeBlock(`${prefix}-tail-note`, 90));
  const tailFormat = makeMessage('user', makeBlock(`${prefix}-tail-format`, 240));
  const statusBase = makeBlock(`${prefix}-tail-status`, 5_800);
  const tailPostamble = makeMessage('user', makeBlock(`${prefix}-tail-postamble`, 2_000));

  const turns: LlmMessage[][] = [];
  for (let turn = 1; turn <= scale.initialTurns + totalRequests - 1; turn += 1) {
    turns.push([
      makeMessage('user', makeBlock(`${prefix}-chat-user-${turn}`, 500)),
      makeMessage('assistant', makeBlock(`${prefix}-chat-assistant-${turn}`, 3_800)),
    ]);
  }

  // 최근 N턴은 tail system 블록 '뒤'에 배치되고, 턴이 지나면 가장 오래된 턴이
  // system 앞의 본 히스토리로 이주한다 — 실측된 분할 채팅 구조.
  let summaryMutations = 0;
  const requests = Array.from({ length: totalRequests }, (_, requestIndex) => {
    const stableTransition =
      scale.stableSummaryPeriod !== undefined &&
      requestIndex % scale.stableSummaryPeriod === 1;
    if (requestIndex > 0 && !stableTransition) summaryMutations += 1;
    const turnCount = scale.initialTurns + requestIndex;
    const recentStart = Math.max(0, turnCount - recentWindowTurns);
    const olderTurns = turns.slice(0, recentStart).flat();
    const recentTurns = turns.slice(recentStart, turnCount).flat();
    return request(
      [
        ...head,
        ...(requestIndex >= memoryAppearsAtRequest ? [longTermMemory] : []),
        makeMessage('system', mutateBlock(summaryBase, summaryMutations)),
        ...olderTurns,
        ...midFixedNotes,
        ...tailSystems,
        ...recentTurns,
        tailNote,
        makeMessage('user', makeBlock(`${prefix}-current-input-${requestIndex + 1}`, 250)),
        tailFormat,
        makeMessage('user', mutateBlock(statusBase, requestIndex)),
        tailPostamble,
      ],
      requestIndex === 0 ? 0 : 5,
    );
  });

  return {
    id: `13-manual-summary-additive-${scale.id}`,
    label: `state-mediated volatile summary above full history (${scale.id})`,
    requests,
  };
}

// 컨텍스트 포화 + 메모리 시스템 부재의 정상상태: 매턴 가장 오래된 턴이 잘리고
// 새 턴이 붙어 메시지 수가 일정하다. 채팅 존 전체가 매턴 shift되어 고정 head만
// 히트 가능한 만성 출혈 패턴이며, reroll-aware의 "같은 개수 = 리롤" 근사가
// 이 상태를 오분류해 2-strike 구제를 포기하는 알려진 한계의 검증 대상이다.
function createTrimSaturationTrajectory(): GoldenTrajectory {
  const windowTurns = 30;
  const totalRequests = 8;
  const head = [
    makeMessage('system', makeBlock('trim-head-main', 8_000)),
    makeMessage('system', makeBlock('trim-head-rule', 5_000)),
    makeMessage('user', makeBlock('trim-head-persona', 2_000)),
  ];
  const tailNote = makeMessage('user', makeBlock('trim-tail-note', 800));
  const turns: LlmMessage[][] = [];
  for (let turn = 1; turn <= windowTurns + totalRequests - 1; turn += 1) {
    turns.push([
      makeMessage('user', makeBlock(`trim-chat-user-${turn}`, 500)),
      makeMessage('assistant', makeBlock(`trim-chat-assistant-${turn}`, 3_800)),
    ]);
  }

  const requests = Array.from({ length: totalRequests }, (_, requestIndex) =>
    request(
      [
        ...head,
        ...turns.slice(requestIndex, requestIndex + windowTurns).flat(),
        makeMessage('user', makeBlock(`trim-current-input-${requestIndex + 1}`, 250)),
        tailNote,
      ],
      requestIndex === 0 ? 0 : 5,
    ),
  );

  return {
    id: '14-trim-saturation',
    label: 'context-full steady trimming without memory systems',
    requests,
  };
}

// 블라인드 사용 일지(모듈 수집가·모바일 라이트) 번역: 방 3개를 한 프리셋으로
// 순환하는 실사용 타임라인. 플러그인의 anchor state는 전역 단일 슬롯이라 방
// 전환마다 직전 방 fingerprint와 diff되어, 서버에 이전 방문의 entry가 살아
// 있어도(30m 내 복귀) 그 경계에 marker를 다시 찍지 못해 exact 매칭 히트를
// 놓친다 — per-chat anchor state 분리의 손익 근거를 측정한다.
function createMultiRoomRoundRobinTrajectory(): GoldenTrajectory {
  const sharedMain = makeMessage('system', makeBlock('mrr-shared-main', 2_480));
  const sharedPersona = makeMessage('user', makeBlock('mrr-shared-persona', 360));
  const sharedNote = makeMessage('user', makeBlock('mrr-shared-global-note', 260));
  interface RoundRobinRoom {
    description: LlmMessage;
    lorebook: LlmMessage;
    turns: LlmMessage[];
  }
  const rooms: Record<'A' | 'B' | 'C', RoundRobinRoom> = {
    A: {
      description: makeMessage('system', makeBlock('mrr-room-A-description', 2_300)),
      lorebook: makeMessage('system', makeBlock('mrr-room-A-lorebook', 4_600)),
      turns: [],
    },
    B: {
      description: makeMessage('system', makeBlock('mrr-room-B-description', 1_100)),
      lorebook: makeMessage('system', makeBlock('mrr-room-B-lorebook', 650)),
      turns: [],
    },
    C: {
      description: makeMessage('system', makeBlock('mrr-room-C-description', 1_700)),
      lorebook: makeMessage('system', makeBlock('mrr-room-C-lorebook', 2_100)),
      turns: [],
    },
  };

  // 방문 스케줄은 일지의 세션 패턴: 방문 내 턴 간격 2~4분, 방문 사이는
  // TTL(30m) 안쪽 복귀 한 번(A, +7분)과 수 시간 공백(전 entry 사망)을 섞는다.
  const visits: readonly { room: keyof typeof rooms; turnCount: number; gapMinutes: number }[] = [
    { room: 'A', turnCount: 4, gapMinutes: 0 },
    { room: 'B', turnCount: 3, gapMinutes: 8 },
    { room: 'A', turnCount: 3, gapMinutes: 7 },
    { room: 'C', turnCount: 4, gapMinutes: 300 },
    { room: 'A', turnCount: 2, gapMinutes: 540 },
  ];

  const requests: TrajectoryRequest[] = [];
  let requestNumber = 0;
  for (const visit of visits) {
    const room = rooms[visit.room];
    for (let turn = 0; turn < visit.turnCount; turn += 1) {
      requestNumber += 1;
      const input = makeMessage('user', makeBlock(`mrr-input-${requestNumber}`, 150));
      requests.push(
        request(
          [
            sharedMain,
            room.description,
            sharedPersona,
            room.lorebook,
            ...room.turns,
            input,
            sharedNote,
          ],
          turn === 0 ? visit.gapMinutes : 2 + (requestNumber % 3),
        ),
      );
      room.turns.push(input, makeMessage('assistant', makeBlock(`mrr-reply-${requestNumber}`, 1_500)));
    }
  }

  return {
    id: '15-multi-room-roundrobin',
    label: 'shared preset rooms interleaved within and beyond TTL',
    requests,
  };
}

// 블라인드 사용 일지(그룹챗 유저) 번역: 응답 캐릭터마다 description·캐릭터
// 로어북 블록(#1·#3)이 교체되는 그룹챗. 한 유저 턴에 캐릭터 2명이 순차
// 응답하며 각 응답이 별도 요청이다. 프리픽스 초입이 요청마다 바뀌어 공통
// 프리픽스가 main(185tok, sub-1024)뿐인 요청이 대부분 — 13번보다 얕은 변동.
function createGroupSpeakerRotationTrajectory(): GoldenTrajectory {
  const main = makeMessage('system', makeBlock('gsr-main', 742));
  const persona = makeMessage('user', makeBlock('gsr-persona', 486));
  const groupLore = makeMessage('system', makeBlock('gsr-group-lorebook', 1_400));
  const postInstruction = makeMessage('user', makeBlock('gsr-post-instruction', 46));
  const characters = ['yun', 'sena', 'dari', 'nox'].map((name, index) => ({
    description: makeMessage('system', makeBlock(`gsr-desc-${name}`, 1_480 + index * 250)),
    lorebook: makeMessage('system', makeBlock(`gsr-lore-${name}`, 400 + index * 180)),
  }));

  // 일지의 발화 패턴: 확률 순서라 연속 동일 응답자도 가끔 나온다.
  const speakerPairs = [
    [0, 1],
    [0, 2],
    [1, 1],
    [3, 0],
    [2, 3],
    [1, 0],
    [0, 0],
    [2, 1],
  ];

  const chat: LlmMessage[] = [];
  const requests: TrajectoryRequest[] = [];
  speakerPairs.forEach((pair, turnIndex) => {
    const input = makeMessage('user', makeBlock(`gsr-input-${turnIndex + 1}`, 180));
    chat.push(input);
    pair.forEach((speakerIndex, replyIndex) => {
      const speaker = characters[speakerIndex];
      requests.push(
        request(
          [
            main,
            speaker.description,
            persona,
            groupLore,
            speaker.lorebook,
            ...chat,
            postInstruction,
          ],
          turnIndex === 0 && replyIndex === 0 ? 0 : 2,
        ),
      );
      chat.push(
        makeMessage('assistant', makeBlock(`gsr-reply-${turnIndex + 1}-${replyIndex + 1}`, 1_100)),
      );
    });
  });

  return {
    id: '16-group-speaker-rotation',
    label: 'per-responder description swap in group chat',
    requests,
  };
}

// 블라인드 사용 일지(리롤 헤비) 번역: 히스토리 중간 수정(in-place), 마지막
// N턴 통삭 후 재진행(prefix 수축→재성장), 이어쓰기(마지막 응답 내용 변경)를
// 일반 append 사이에 끼워 넣은 타임라인. 04(동일 길이 리롤)·06(뭉텅이 트림)이
// 못 덮는 과거 개서 동역학이다.
function createMidHistoryEditsTrajectory(): GoldenTrajectory {
  const head = [
    makeMessage('system', makeBlock('mhe-main', 1_760)),
    makeMessage('system', makeBlock('mhe-description', 4_850)),
    makeMessage('user', makeBlock('mhe-persona', 860)),
    makeMessage('system', makeBlock('mhe-lorebook', 2_960)),
  ];
  const tailNote = makeMessage('user', makeBlock('mhe-global-note', 430));

  const chat: LlmMessage[] = [];
  const appendTurn = (turnNumber: number, variant = '') => {
    chat.push(
      makeMessage('user', makeBlock(`mhe-input-${turnNumber}${variant}`, 250)),
      makeMessage('assistant', makeBlock(`mhe-reply-${turnNumber}${variant}`, 1_500)),
    );
  };
  for (let turn = 1; turn <= 6; turn += 1) appendTurn(turn);

  const snapshot = () =>
    request([...head, ...chat, tailNote], 3);
  const requests: TrajectoryRequest[] = [{ ...snapshot(), elapsedMinutes: 0 }];

  // 7~8턴 일반 진행.
  appendTurn(7);
  requests.push(snapshot());
  appendTurn(8);
  requests.push(snapshot());

  // 과거 응답 in-place 수정: 3턴째 응답을 고쳐 그 지점부터 프리픽스가 끊긴다.
  chat[5] = makeMessage('assistant', makeBlock('mhe-reply-3-edited', 1_420));
  requests.push(snapshot());

  // 마지막 2턴 통삭 후 재진행: 요청이 직전 요청의 프리픽스로 수축했다가 다시 자란다.
  chat.splice(chat.length - 4, 4);
  requests.push(snapshot());
  appendTurn(7, 'redo');
  requests.push(snapshot());
  appendTurn(8, 'redo');
  requests.push(snapshot());

  // 이어쓰기: 마지막 응답 내용이 늘어난다.
  chat[chat.length - 1] = makeMessage('assistant', makeBlock('mhe-reply-8redo-extended', 2_100));
  requests.push(snapshot());

  // 깊은 단일 메시지 삭제(shift) 후 일반 진행 재개.
  chat.splice(2, 2);
  requests.push(snapshot());
  appendTurn(9);
  requests.push(snapshot());
  appendTurn(10);
  requests.push(snapshot());

  return {
    id: '17-mid-history-edits',
    label: 'in-place edits, rollback replay, and deep deletion',
    requests,
  };
}

// 2026-07-19 익명 실환경 trace의 89k·67k write 사건을 최소 구조로 번역한다.
// 2-strike가 latest frontier를 억제한 상태에서도, 다음 length-change가 만드는
// prefixLength-1 branch boundary는 중간 앵커가 되어 slice(0, -1)을 빠져나간다.
// 실로그의 신규 경계 추정치(51k~63k)에 맞춰 큰 안정 히스토리를 60k로 둔다.
function createSuppressedFrontierBranchBoundaryTrajectory(): GoldenTrajectory {
  const stableHead = makeMessage('system', makeBlock('branch-bypass-head', 6_000));
  const stableSuffix = makeMessage('user', 'Stable request footer.');
  const largeStableHistory = makeMessage('user', makeBlock('branch-bypass-large-history', 240_000));
  const stableMiddle = makeMessage('system', makeBlock('branch-bypass-stable-middle', 1_000));

  return {
    id: '18-suppressed-frontier-branch-boundary',
    label: 'new branch boundary bypasses active frontier suppression',
    requests: [
      request(
        [
          stableHead,
          makeMessage('system', makeBlock('branch-bypass-bootstrap-A', 1_000)),
          stableSuffix,
        ],
        0,
      ),
      request([
        stableHead,
        makeMessage('system', makeBlock('branch-bypass-bootstrap-B', 1_000)),
        makeMessage('system', makeBlock('branch-bypass-bootstrap-growth', 800)),
        stableSuffix,
      ]),
      request([
        stableHead,
        largeStableHistory,
        stableMiddle,
        makeMessage('system', makeBlock('branch-bypass-volatile-A', 1_000)),
        stableSuffix,
      ]),
      request([
        stableHead,
        largeStableHistory,
        stableMiddle,
        makeMessage('system', makeBlock('branch-bypass-volatile-B', 1_000)),
        makeMessage('system', makeBlock('branch-bypass-new-frontier', 800)),
        stableSuffix,
      ]),
    ],
  };
}

export function createGoldenTrajectories(): readonly GoldenTrajectory[] {
  return [
    createAppendOnlyTrajectory(),
    createLeadingCbsTrapTrajectory(),
    createReverseDepthTrajectory(),
    createRerollTrajectory(),
    createLoreToggleTrajectory(),
    createContextTrimmingTrajectory(),
    createHypaSummaryTrajectory(),
    createLuaPostEditTrajectory(),
    createRoomSwitchTrajectory(),
    createTtlGapTrajectory(),
    createChurnThenStableTrajectory(),
    createChurnOscillatingTrajectory(),
    ...MANUAL_SUMMARY_SCALES.map(createManualSummaryAdditiveTrajectory),
    createTrimSaturationTrajectory(),
    createMultiRoomRoundRobinTrajectory(),
    createGroupSpeakerRotationTrajectory(),
    createMidHistoryEditsTrajectory(),
    createSuppressedFrontierBranchBoundaryTrajectory(),
  ];
}
