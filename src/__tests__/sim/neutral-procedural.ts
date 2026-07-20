import type { LlmMessage } from 'llm-io';
import type { GoldenTrajectory, TrajectoryRequest } from './replay';

/**
 * 시드 기반 절차적 중립 벤치마크 세션 생성기.
 *
 * 공정성 원칙: 아래 확률·범위 파라미터는 특정 캐싱 정책의 결과를 보기 전에
 * "RisuAI 실사용 감각"만으로 확정한 사전(a priori) 값이다. 결과를 본 뒤
 * 파라미터를 조정하지 않는다 — 조정이 필요하면 별도 스위트로 추가한다.
 *
 * 세션 모델 (파라미터 전부 이 파일 안에 명시):
 * - 카드 3k~40k tok(로그균등), 페르소나 0.2k~2k, 상시 로어 0~8k(30%는 없음)
 * - 매 요청 가변 system 블록(CBS 랜덤 매크로 카드) 15% 세션, 0.5k~1.5k tok
 * - 메모리 시스템 40% 세션: 0.8k 시작, 5~8턴마다 갱신·성장(+0.1k~0.4k)
 * - 조건부 로어 6종(0.3k~1.5k): 블록별 활성 확률 0.3, 턴마다 70% 이전 상태 유지
 * - depth 주입(작가노트) 30% 세션: 0.4k~0.9k, 히스토리 끝-3 위치
 * - 그룹 채팅 12% 세션: 화자 설명 3종(1k~3k)이 카드 직후에서 매 턴 교대
 * - 방 전환 12% 세션: 중반에 카드 B로 전환, 그중 50%는 10~40분 뒤 방 A 복귀
 * - 턴 10~22, user 40~400 tok, assistant 세션 평균 0.3k~2.5k에 턴별 ±50%
 * - 리롤(동일 프롬프트 재전송) 턴당 22%, 연속 1~3회, 간격 0.3~1.5분
 * - 중간 수정 턴당 6%, 롤백(마지막 1~2쌍 삭제 후 재진행) 턴당 4%
 * - 턴 간격: 70% 0.5~6분 / 20% 8~25분 / 10% 32~75분 (TTL 30분 초과 포함)
 * - 컨텍스트 예산 60k~140k tok 초과 시 오래된 히스토리 쌍부터 트림
 */

const SESSION_SEED_COUNT = 30;

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

function uniformInt(rng: () => number, minimum: number, maximum: number): number {
  return Math.floor(uniform(rng, minimum, maximum + 1));
}

function logUniformInt(rng: () => number, minimum: number, maximum: number): number {
  return Math.round(Math.exp(uniform(rng, Math.log(minimum), Math.log(maximum))));
}

function makeText(label: string, tokens: number): string {
  const sentence = `[${label}] Procedural neutral benchmark prose keeps weather logs, corridor maps, ledger totals, and numbered field observations flowing. `;
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

function sampleGapMinutes(rng: () => number): number {
  const roll = rng();
  if (roll < 0.7) return uniform(rng, 0.5, 6);
  if (roll < 0.9) return uniform(rng, 8, 25);
  return uniform(rng, 32, 75);
}

interface RoomState {
  history: LlmMessage[];
  prefix: {
    baseLore: LlmMessage | null;
    card: LlmMessage;
    persona: LlmMessage;
  };
  activeLore: boolean[];
  memoryVersion: number;
  memoryTokens: number;
}

function buildSessionTrajectory(seed: number): GoldenTrajectory {
  const rng = createRng(seed * 7919 + 17);
  const sessionId = `p${String(seed).padStart(2, '0')}`;

  const contextBudgetTokens = uniformInt(rng, 60_000, 140_000);
  const hasRandomizedSystem = rng() < 0.15;
  const hasMemory = rng() < 0.4;
  const hasDepthNote = rng() < 0.3;
  const isGroupChat = rng() < 0.12;
  const hasRoomSwitch = rng() < 0.12;
  const returnsToFirstRoom = hasRoomSwitch && rng() < 0.5;
  const turnCount = uniformInt(rng, 10, 22);
  const assistantMeanTokens = uniformInt(rng, 300, 2_500);
  const memoryUpdateInterval = uniformInt(rng, 5, 8);

  const conditionalLoreTokens = Array.from({ length: 6 }, () => uniformInt(rng, 300, 1_500));
  const speakerDescriptions = isGroupChat
    ? Array.from({ length: 3 }, (_, speakerIndex) =>
        makeMessage('system', `${sessionId}-speaker-${speakerIndex}`, uniformInt(rng, 1_000, 3_000)),
      )
    : [];
  const depthNote = hasDepthNote
    ? makeMessage('system', `${sessionId}-depth-note`, uniformInt(rng, 400, 900))
    : null;

  function createRoom(roomKey: string): RoomState {
    return {
      history: [],
      prefix: {
        baseLore:
          rng() < 0.7
            ? makeMessage('system', `${sessionId}-${roomKey}-base-lore`, uniformInt(rng, 500, 8_000))
            : null,
        card: makeMessage(
          'system',
          `${sessionId}-${roomKey}-card`,
          logUniformInt(rng, 3_000, 40_000),
        ),
        persona: makeMessage('system', `${sessionId}-persona`, uniformInt(rng, 200, 2_000)),
      },
      activeLore: conditionalLoreTokens.map(() => rng() < 0.3),
      memoryVersion: 0,
      memoryTokens: 800,
    };
  }

  const rooms: Record<string, RoomState> = { a: createRoom('a') };
  if (hasRoomSwitch) rooms.b = createRoom('b');
  const switchAtTurn = hasRoomSwitch ? uniformInt(rng, 4, Math.max(5, turnCount - 3)) : -1;
  const returnAtTurn = returnsToFirstRoom
    ? Math.min(turnCount, switchAtTurn + uniformInt(rng, 2, 4))
    : -1;

  let randomizedBlockVersion = 0;
  const requests: TrajectoryRequest[] = [];

  function assembleRequest(room: RoomState, roomKey: string, turn: number): LlmMessage[] {
    const messages: LlmMessage[] = [room.prefix.card];
    if (isGroupChat) messages.push(speakerDescriptions[turn % speakerDescriptions.length]);
    messages.push(room.prefix.persona);
    if (room.prefix.baseLore !== null) messages.push(room.prefix.baseLore);
    if (hasRandomizedSystem) {
      randomizedBlockVersion += 1;
      messages.push(
        makeMessage(
          'system',
          `${sessionId}-random-${randomizedBlockVersion}`,
          uniformInt(rng, 500, 1_500),
        ),
      );
    }
    if (hasMemory && room.memoryVersion > 0) {
      messages.push(
        makeMessage(
          'system',
          `${sessionId}-${roomKey}-memory-v${room.memoryVersion}`,
          room.memoryTokens,
        ),
      );
    }
    room.activeLore.forEach((active, loreIndex) => {
      if (active) {
        messages.push(
          makeMessage(
            'system',
            `${sessionId}-lore-${loreIndex}`,
            conditionalLoreTokens[loreIndex],
          ),
        );
      }
    });

    const historyWithDepth = [...room.history];
    if (depthNote !== null && historyWithDepth.length >= 1) {
      historyWithDepth.splice(Math.max(0, historyWithDepth.length - 3), 0, depthNote);
    }
    return [...messages, ...historyWithDepth];
  }

  function trimHistory(room: RoomState, roomKey: string, turn: number): void {
    while (
      room.history.length > 4 &&
      assembleRequest(room, roomKey, turn).reduce(
        (total, message) => total + estimateMessageTokens(message),
        0,
      ) > contextBudgetTokens
    ) {
      room.history.splice(0, 2);
    }
  }

  let currentRoomKey = 'a';
  for (let turn = 1; turn <= turnCount; turn += 1) {
    if (turn === switchAtTurn) currentRoomKey = 'b';
    if (turn === returnAtTurn) currentRoomKey = 'a';
    const room = rooms[currentRoomKey];

    // 조건부 로어 토글: 블록별 70% 유지, 30% 재추첨(활성 확률 0.3)
    room.activeLore = room.activeLore.map((active) => (rng() < 0.7 ? active : rng() < 0.3));
    if (hasMemory && turn % memoryUpdateInterval === 0) {
      room.memoryVersion += 1;
      room.memoryTokens += uniformInt(rng, 100, 400);
    }
    if (rng() < 0.06 && room.history.length >= 6) {
      const editIndex = room.history.length - 2 * uniformInt(rng, 2, 3);
      const edited = room.history[editIndex];
      if (edited !== undefined && edited.role === 'assistant') {
        room.history[editIndex] = makeMessage(
          'assistant',
          `${sessionId}-edited-t${turn}-i${editIndex}`,
          estimateMessageTokens(edited),
        );
      }
    }
    if (rng() < 0.04 && room.history.length >= 4) {
      room.history.splice(room.history.length - 2 * uniformInt(rng, 1, 2));
    }

    room.history.push(
      makeMessage('user', `${sessionId}-${currentRoomKey}-user-t${turn}`, uniformInt(rng, 40, 400)),
    );
    trimHistory(room, currentRoomKey, turn);

    const promptMessages = assembleRequest(room, currentRoomKey, turn);
    requests.push({
      elapsedMinutes: requests.length === 0 ? 0 : sampleGapMinutes(rng),
      messages: promptMessages,
    });

    // 리롤: 동일 프롬프트 재전송 (RisuAI regenerate는 같은 요청을 다시 보낸다)
    if (rng() < 0.22) {
      const rerollCount = uniformInt(rng, 1, 3);
      for (let reroll = 0; reroll < rerollCount; reroll += 1) {
        requests.push({
          elapsedMinutes: uniform(rng, 0.3, 1.5),
          messages: promptMessages,
        });
      }
    }

    const assistantTokens = Math.max(
      120,
      Math.round(assistantMeanTokens * uniform(rng, 0.5, 1.5)),
    );
    room.history.push(
      makeMessage(
        'assistant',
        `${sessionId}-${currentRoomKey}-assistant-t${turn}`,
        assistantTokens,
      ),
    );
  }

  const featureTags = [
    hasRandomizedSystem ? 'cbs' : null,
    hasMemory ? 'memory' : null,
    hasDepthNote ? 'depth' : null,
    isGroupChat ? 'group' : null,
    hasRoomSwitch ? (returnsToFirstRoom ? 'room-return' : 'room-switch') : null,
  ].filter((tag): tag is string => tag !== null);
  return {
    id: `proc-${sessionId}`,
    label: `procedural seed ${seed}${featureTags.length > 0 ? ` (${featureTags.join(',')})` : ''}`,
    requests,
  };
}

export function createProceduralTrajectories(): readonly GoldenTrajectory[] {
  return Array.from({ length: SESSION_SEED_COUNT }, (_, index) =>
    buildSessionTrajectory(index + 1),
  );
}
