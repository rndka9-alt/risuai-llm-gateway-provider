import type { LlmMessage } from 'llm-io';
import type { SimulationScenario, ScenarioRequest } from '../scenario-contract';
import { makeBlock, makeMessage, request } from './fixture-builders';

// 컨텍스트 포화 + 메모리 시스템 부재의 정상상태: 매턴 가장 오래된 턴이 잘리고
// 새 턴이 붙어 메시지 수가 일정하다. 채팅 존 전체가 매턴 shift되어 고정 head만
// 히트 가능한 만성 출혈 패턴이며, reroll-aware의 "같은 개수 = 리롤" 근사가
// 이 상태를 오분류해 2-strike 구제를 포기하는 알려진 한계의 검증 대상이다.
export function createTrimSaturationScenario(): SimulationScenario {
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

// 블라인드 사용 일지(그룹챗 유저) 번역: 응답 캐릭터마다 description·캐릭터
// 로어북 블록(#1·#3)이 교체되는 그룹챗. 한 유저 턴에 캐릭터 2명이 순차
// 응답하며 각 응답이 별도 요청이다. 프리픽스 초입이 요청마다 바뀌어 공통
// 프리픽스가 main(185tok, sub-1024)뿐인 요청이 대부분 — 13번보다 얕은 변동.
// 그룹챗은 실사용 빈도가 매우 낮으므로 중요도·우선순위·임팩트를 낮게 취급하고,
// 멀티룸 지표를 해석할 때도 이 시나리오의 가중치를 낮춰 본다.
export function createGroupSpeakerRotationScenario(): SimulationScenario {
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
  const requests: ScenarioRequest[] = [];
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
export function createMidHistoryEditsScenario(): SimulationScenario {
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

  const snapshot = () => request([...head, ...chat, tailNote], 3);
  const requests: ScenarioRequest[] = [{ ...snapshot(), elapsedMinutes: 0 }];

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
