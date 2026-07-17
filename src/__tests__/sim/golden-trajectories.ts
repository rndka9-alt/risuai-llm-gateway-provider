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
  ];
}
