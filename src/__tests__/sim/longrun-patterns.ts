import type { LlmMessage } from 'llm-io';
import type { GoldenTrajectory, TrajectoryRequest } from './replay';

/**
 * 단일 패턴 × 장기(60턴) 스위트.
 *
 * 전제: 실사용자는 설정(카드·메모리·로어 구성)을 자주 바꾸지 않아 한 사용 패턴이
 * 장기 지속된다. 혼합 분포의 가중 평균 대신 "이 패턴으로 사는 유저의 기대 효율"을
 * 패턴별로 측정한다. 파라미터는 결과를 보기 전에 확정한 사전값이다.
 */

const TURNS_PER_PATTERN = 60;

interface LongRunPatternConfig {
  id: string;
  label: string;
  assistantMeanTokens: number;
  cardTokens: number;
  trimBudgetTokens: number;
  cbsVolatileBlock?: boolean;
  depthNote?: boolean;
  groupSpeakerSwap?: boolean;
  longIdleEveryTurns?: number;
  loreChurnEveryTurn?: boolean;
  memoryUpdateEveryTurns?: number;
  midEditEveryTurns?: number;
  rerollProbability?: number;
  roomPingPongEveryTurns?: number;
}

// 사전 확정 패턴 목록 — 2라운드에서 정책 간 승패가 갈렸던 축을 하나씩 고정 재현.
const PATTERN_CONFIGS: readonly LongRunPatternConfig[] = [
  {
    id: 'lr01-append',
    label: '순수 append 장기 세션',
    assistantMeanTokens: 600,
    cardTokens: 8_000,
    trimBudgetTokens: 70_000,
  },
  {
    id: 'lr02-reroll-heavy',
    label: '리롤 헤비 유저 (턴당 50%)',
    assistantMeanTokens: 600,
    cardTokens: 8_000,
    rerollProbability: 0.5,
    trimBudgetTokens: 70_000,
  },
  {
    id: 'lr03-lore-churn',
    label: '조건부 로어 매턴 토글',
    assistantMeanTokens: 600,
    cardTokens: 8_000,
    loreChurnEveryTurn: true,
    trimBudgetTokens: 70_000,
  },
  {
    id: 'lr04-cbs-volatile',
    label: 'CBS 랜덤 매크로 카드',
    assistantMeanTokens: 600,
    cardTokens: 8_000,
    cbsVolatileBlock: true,
    trimBudgetTokens: 70_000,
  },
  {
    id: 'lr05-memory',
    label: '메모리 요약 6턴 주기 갱신',
    assistantMeanTokens: 600,
    cardTokens: 8_000,
    memoryUpdateEveryTurns: 6,
    trimBudgetTokens: 70_000,
  },
  {
    id: 'lr06-trim-rolling',
    label: '포화 컨텍스트 상시 트림',
    assistantMeanTokens: 1_200,
    cardTokens: 8_000,
    trimBudgetTokens: 30_000,
  },
  {
    id: 'lr07-group-swap',
    label: '그룹 채팅 화자 카드 매턴 스왑',
    assistantMeanTokens: 600,
    cardTokens: 8_000,
    groupSpeakerSwap: true,
    trimBudgetTokens: 70_000,
  },
  {
    id: 'lr08-room-pingpong',
    label: '두 방 6턴 주기 왕복 (TTL 이내)',
    assistantMeanTokens: 600,
    cardTokens: 8_000,
    roomPingPongEveryTurns: 6,
    trimBudgetTokens: 70_000,
  },
  {
    id: 'lr09-depth-note',
    label: 'depth 작가노트 매턴 이동',
    assistantMeanTokens: 600,
    cardTokens: 8_000,
    depthNote: true,
    trimBudgetTokens: 70_000,
  },
  {
    id: 'lr10-mid-edit',
    label: '3턴마다 과거 제자리 수정',
    assistantMeanTokens: 600,
    cardTokens: 8_000,
    midEditEveryTurns: 3,
    trimBudgetTokens: 70_000,
  },
  {
    id: 'lr11-long-idle',
    label: '5턴마다 35~50분 자리비움 (TTL 만료)',
    assistantMeanTokens: 600,
    cardTokens: 8_000,
    longIdleEveryTurns: 5,
    trimBudgetTokens: 70_000,
  },
];

function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function uniform(rng: () => number, minimum: number, maximum: number): number {
  return minimum + rng() * (maximum - minimum);
}

function makeText(label: string, tokens: number): string {
  const sentence = `[${label}] Long-run single-pattern benchmark prose logs the same daily route, shelf indexes, weather margins, and numbered notes. `;
  const characters = Math.max(8, Math.round(tokens * 4));
  return sentence.repeat(Math.ceil(characters / sentence.length)).slice(0, characters);
}

function makeMessage(role: LlmMessage['role'], label: string, tokens: number): LlmMessage {
  return { role, content: [{ type: 'text', text: makeText(label, tokens) }] };
}

function estimateMessageTokens(message: LlmMessage): number {
  return message.content.reduce(
    (total, part) => total + (part.type === 'text' ? Math.ceil(part.text.length / 4) : 0),
    0,
  );
}

function buildPatternTrajectory(
  config: LongRunPatternConfig,
  seed: number,
  turnCount: number = TURNS_PER_PATTERN,
): GoldenTrajectory {
  const rng = createRng(seed * 104729 + 7);
  const id = config.id;

  interface Room {
    card: LlmMessage;
    history: LlmMessage[];
    memoryTokens: number;
    memoryVersion: number;
  }
  const rooms: Room[] = [
    {
      card: makeMessage('system', `${id}-card-a`, config.cardTokens),
      history: [],
      memoryTokens: 800,
      memoryVersion: 0,
    },
  ];
  if (config.roomPingPongEveryTurns !== undefined) {
    rooms.push({
      card: makeMessage('system', `${id}-card-b`, config.cardTokens),
      history: [],
      memoryTokens: 800,
      memoryVersion: 0,
    });
  }
  const persona = makeMessage('system', `${id}-persona`, 800);
  const loreBlocks = Array.from({ length: 4 }, (_, index) =>
    makeMessage('system', `${id}-lore-${index}`, 800),
  );
  const speakerDescriptions = Array.from({ length: 3 }, (_, index) =>
    makeMessage('system', `${id}-speaker-${index}`, 1_500),
  );
  const depthNote = makeMessage('system', `${id}-depth-note`, 500);
  const activeLore = [true, false, true, false];

  let cbsVersion = 0;
  const requests: TrajectoryRequest[] = [];

  function assemble(room: Room, turn: number): LlmMessage[] {
    const messages: LlmMessage[] = [room.card];
    if (config.groupSpeakerSwap === true) {
      messages.push(speakerDescriptions[turn % speakerDescriptions.length]);
    }
    messages.push(persona);
    if (config.cbsVolatileBlock === true) {
      cbsVersion += 1;
      messages.push(makeMessage('system', `${id}-cbs-${cbsVersion}`, 800));
    }
    if (config.memoryUpdateEveryTurns !== undefined && room.memoryVersion > 0) {
      messages.push(
        makeMessage('system', `${id}-memory-v${room.memoryVersion}`, room.memoryTokens),
      );
    }
    if (config.loreChurnEveryTurn === true) {
      activeLore.forEach((active, index) => {
        if (active) messages.push(loreBlocks[index]);
      });
    }
    const history = [...room.history];
    if (config.depthNote === true && history.length >= 1) {
      history.splice(Math.max(0, history.length - 3), 0, depthNote);
    }
    return [...messages, ...history];
  }

  function trim(room: Room, turn: number): void {
    while (
      room.history.length > 4 &&
      assemble(room, turn).reduce((total, message) => total + estimateMessageTokens(message), 0) >
        config.trimBudgetTokens
    ) {
      room.history.splice(0, 2);
    }
  }

  for (let turn = 1; turn <= turnCount; turn += 1) {
    const roomIndex =
      config.roomPingPongEveryTurns === undefined
        ? 0
        : Math.floor((turn - 1) / config.roomPingPongEveryTurns) % rooms.length;
    const room = rooms[roomIndex];

    if (config.loreChurnEveryTurn === true) {
      // 매턴 로어 블록 하나가 라운드로빈으로 토글 → 선두 프리픽스가 항상 변한다.
      const toggleIndex = (turn - 1) % activeLore.length;
      activeLore[toggleIndex] = !activeLore[toggleIndex];
    }
    if (config.memoryUpdateEveryTurns !== undefined && turn % config.memoryUpdateEveryTurns === 0) {
      room.memoryVersion += 1;
      room.memoryTokens += 200;
    }
    if (
      config.midEditEveryTurns !== undefined &&
      turn % config.midEditEveryTurns === 0 &&
      room.history.length >= 6
    ) {
      const editIndex = room.history.length - 4;
      const edited = room.history[editIndex];
      if (edited !== undefined && edited.role === 'assistant') {
        room.history[editIndex] = makeMessage(
          'assistant',
          `${id}-edited-t${turn}`,
          estimateMessageTokens(edited),
        );
      }
    }

    room.history.push(makeMessage('user', `${id}-user-t${turn}`, Math.round(uniform(rng, 80, 200))));
    trim(room, turn);

    const promptMessages = assemble(room, turn);
    const isLongIdleTurn =
      config.longIdleEveryTurns !== undefined && turn % config.longIdleEveryTurns === 0;
    requests.push({
      elapsedMinutes:
        requests.length === 0 ? 0 : isLongIdleTurn ? uniform(rng, 35, 50) : uniform(rng, 1, 4),
      messages: promptMessages,
    });

    if (config.rerollProbability !== undefined && rng() < config.rerollProbability) {
      const rerollCount = 1 + Math.floor(rng() * 3);
      for (let reroll = 0; reroll < rerollCount; reroll += 1) {
        requests.push({ elapsedMinutes: uniform(rng, 0.3, 1.5), messages: promptMessages });
      }
    }

    room.history.push(
      makeMessage(
        'assistant',
        `${id}-assistant-t${turn}`,
        Math.max(150, Math.round(config.assistantMeanTokens * uniform(rng, 0.6, 1.4))),
      ),
    );
  }

  return { id, label: config.label, requests };
}

export function createLongRunPatternTrajectories(): readonly GoldenTrajectory[] {
  return PATTERN_CONFIGS.map((config, index) => buildPatternTrajectory(config, index + 1));
}

// append 패턴만 턴 수를 바꿔가며 생성 — 축출 병리의 발병 시점(크로스오버) 측정용.
export function createAppendSweepTrajectories(
  turnCounts: readonly number[],
): readonly GoldenTrajectory[] {
  return turnCounts.map((turnCount) => {
    const trajectory = buildPatternTrajectory(
      { ...PATTERN_CONFIGS[0], id: `sweep-append-t${turnCount}` },
      1,
      turnCount,
    );
    return { ...trajectory, label: `append ${turnCount}턴 스윕` };
  });
}
