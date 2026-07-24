import type { LlmMessage } from 'llm-io';
import type { GoldenTrajectory, TrajectoryRequest } from '../../core/replay';
import { makeBlock, makeMessage, request } from './fixture-builders';

// 블라인드 사용 일지(모듈 수집가·모바일 라이트) 번역: 방 3개를 한 프리셋으로
// 순환하는 실사용 타임라인. 공유 헤더 때문에 최장 프리픽스만으로는 다른 방을
// 우연 채택하지만, frontier보다 얕은 이질 전이는 새 그룹으로 fork되어 원본
// fingerprint를 보존한다. TTL 내 왕복에서 양쪽 marker가 살아나는지 측정한다.
export function createMultiRoomRoundRobinTrajectory(): GoldenTrajectory {
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
      room.turns.push(
        input,
        makeMessage('assistant', makeBlock(`mrr-reply-${requestNumber}`, 1_500)),
      );
    }
  }

  return {
    id: '15-multi-room-roundrobin',
    label: 'shared preset rooms interleaved within and beyond TTL',
    requests,
  };
}

// 첫 fingerprint가 서로 다른 세 방을 TTL 안에서 A→B→C로 반복 방문한다.
// 단일 슬롯은 매 요청 cold epoch가 되지만 content-addressed bank는 두 번째
// 방문부터 각 방의 frontier·admission을 이어받고 세 번째 방문부터 read한다.
export function createContentAddressedRoundRobinTrajectory(): GoldenTrajectory {
  const rooms: Array<{
    head: LlmMessage;
    lorebook: LlmMessage;
    persona: LlmMessage;
    room: string;
    turns: LlmMessage[];
  }> = ['A', 'B', 'C'].map((room) => ({
    head: makeMessage('system', makeBlock(`car-${room}-head`, 6_000)),
    persona: makeMessage('user', makeBlock(`car-${room}-persona`, 1_000)),
    lorebook: makeMessage('system', makeBlock(`car-${room}-lorebook`, 2_500)),
    room,
    turns: [],
  }));
  const requests: TrajectoryRequest[] = [];
  let requestNumber = 0;

  for (let cycle = 1; cycle <= 4; cycle += 1) {
    for (const room of rooms) {
      requestNumber += 1;
      const input = makeMessage('user', makeBlock(`car-${room.room}-input-${cycle}`, 180));
      requests.push(
        request(
          [room.head, room.persona, room.lorebook, ...room.turns, input],
          requestNumber === 1 ? 0 : 2,
        ),
      );
      room.turns.push(
        input,
        makeMessage('assistant', makeBlock(`car-${room.room}-reply-${cycle}`, 1_500)),
      );
    }
  }

  return {
    id: '21-content-addressed-roundrobin',
    label: 'distinct-prefix rooms in strict A-B-C rotation within TTL',
    requests,
  };
}

// 큰 프롬프트지만 첫 관찰이라 admission되지 않는 churn 그룹과, 이미 4BP로
// 성숙한 정상 방을 교차한다. 두 번의 churn miss마다 정상 방 매치가 전역 miss
// 카운터를 지워 백오프는 발동하지 않는다. 16칸 포화 뒤에는 얕은 churn 그룹이
// 먼저 축출돼 정상 방 상태가 남아야 한다. 복귀는 매번 append하며, 활성 방은
// 30분 안팎을 섞고 장기 미접근 방은 TTL 만료 뒤 돌아와 state 보존과 gateway
// entry 생존을 구분한다.
export function createCrossChurnEvictionTrajectory(): GoldenTrajectory {
  interface NormalRoom {
    head: LlmMessage;
    id: 'B' | 'C';
    turns: LlmMessage[];
  }

  const normalRooms: NormalRoom[] = (['B', 'C'] as const).map((roomId) => ({
    head: makeMessage('system', makeBlock(`cross-${roomId}-head`, 6_000)),
    id: roomId,
    turns: [],
  }));
  const requests: TrajectoryRequest[] = [];
  const appendRoomRequest = (room: NormalRoom, turn: number, elapsedMinutes: number): void => {
    const input = makeMessage('user', makeBlock(`cross-${room.id}-input-${turn}`, 180));
    requests.push(request([room.head, ...room.turns, input], elapsedMinutes));
    room.turns.push(
      input,
      makeMessage('assistant', makeBlock(`cross-${room.id}-reply-${turn}`, 1_500)),
    );
  };

  for (const room of normalRooms) {
    for (let turn = 1; turn <= 5; turn += 1) appendRoomRequest(room, turn, turn === 1 ? 0 : 2);
  }

  const activeRoom = normalRooms[0];
  const longIdleRoom = normalRooms[1];
  if (activeRoom === undefined || longIdleRoom === undefined) {
    throw new Error('Cross-churn trajectory requires two normal rooms.');
  }
  let activeTurn = 6;
  for (let churn = 1; churn <= 15; churn += 1) {
    requests.push(
      request(
        [
          makeMessage('system', makeBlock(`cross-A-churn-${churn}`, 400)),
          makeMessage('user', `Cross churn input ${churn}.`),
        ],
        churn === 9 ? 31 : 2,
      ),
    );
    if (churn % 2 === 0 || churn === 15) {
      appendRoomRequest(activeRoom, activeTurn, 1);
      activeTurn += 1;
    }
  }

  appendRoomRequest(longIdleRoom, 6, 31);

  return {
    id: '22-cross-churn-eviction',
    label: 'interleaved churn evicts shallow groups while TTL governs room returns',
    requests,
  };
}
