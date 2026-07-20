import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAIChatCompletionsFormat, type LlmMessage } from 'llm-io';
import {
  CACHE_ANCHOR_STATE_STORAGE_KEY,
  CACHE_BACKOFF_EPOCH_RESET_THRESHOLD,
  DISABLED_PROMPT_CACHE_KEY,
  EXPLICIT_PROMPT_CACHE_KEY,
  commitPromptCacheState,
  fingerprintMessage,
  getPromptCacheKey,
  isCacheBackoffActive,
  loadCacheAnchorState,
  markCacheBreakpoints,
  planCacheAnchors,
  preparePromptCacheRequest,
  resolvePromptCacheMode,
  saveCacheAnchorState,
  type CacheAnchorState,
  type CacheBackoffTransition,
  type CachePlan,
} from '../cache';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('prompt cache mode', () => {
  it('explicit 값만 explicit 모드로 판별한다', () => {
    expect(resolvePromptCacheMode('explicit')).toBe('explicit');
    expect(resolvePromptCacheMode(' explicit ')).toBe('explicit');
  });

  it('disabled 값만 disabled 모드로 판별한다', () => {
    expect(resolvePromptCacheMode('disabled')).toBe('disabled');
    expect(resolvePromptCacheMode(' disabled ')).toBe('disabled');
  });

  it.each([undefined, '', 'unknown'])('%s 값은 기본값 explicit로 판별한다', (value) => {
    expect(resolvePromptCacheMode(value)).toBe('explicit');
  });
});

describe('prompt cache request wiring', () => {
  it('모드별 캐시 키를 선택한다', () => {
    expect(getPromptCacheKey('explicit')).toBe(EXPLICIT_PROMPT_CACHE_KEY);
    expect(getPromptCacheKey('disabled')).toBe(DISABLED_PROMPT_CACHE_KEY);
  });

  it.each([
    ['explicit', EXPLICIT_PROMPT_CACHE_KEY],
    ['disabled', DISABLED_PROMPT_CACHE_KEY],
  ] satisfies ReadonlyArray<readonly ['explicit' | 'disabled', string]>)(
    '%s 모드에 explicit 캐시 옵션과 해당 키를 구성한다',
    async (mode, promptCacheKey) => {
      vi.stubGlobal('risuai', {
        pluginStorage: {
          getItem: async () => null,
        },
      });

      const prepared = await preparePromptCacheRequest([], mode);

      expect(prepared.cacheExtraBody).toEqual({
        prompt_cache_key: promptCacheKey,
        prompt_cache_options: { mode: 'explicit', ttl: '30m' },
      });
    },
  );
});

function makeMessage(role: LlmMessage['role'], text: string): LlmMessage {
  return { role, content: [{ type: 'text', text }] };
}

function breakpointIndexes(messages: readonly LlmMessage[]): number[] {
  const indexes: number[] = [];
  messages.forEach((message, index) => {
    const marked = message.content.some(
      (part) =>
        (part.type === 'text' || part.type === 'image') && part.cacheBreakpoint !== undefined,
    );
    if (marked) indexes.push(index);
  });
  return indexes;
}

// 여러 턴을 순차 실행해 마지막 턴의 plan을 얻는다.
function planTurns(turns: readonly (readonly LlmMessage[])[]): CachePlan {
  let state: CacheAnchorState | null = null;
  let plan: CachePlan | null = null;
  for (const turn of turns) {
    plan = planCacheAnchors(state, turn);
    state = plan.nextState;
  }
  if (plan === null) throw new Error('planTurns requires at least one turn');
  return plan;
}

function markedIndexesOfLastTurn(turns: readonly (readonly LlmMessage[])[]): number[] {
  const plan = planTurns(turns);
  const lastTurn = turns[turns.length - 1];
  return breakpointIndexes(markCacheBreakpoints([...lastTurn], plan));
}

const LONG_SYSTEM_TEXT = 'S'.repeat(6000);

describe('planCacheAnchors / markCacheBreakpoints', () => {
  it('16k 이하 첫 턴 frontier는 즉시 assistant를 건너뛰어 마킹한다', () => {
    const firstTurn = [
      makeMessage('system', LONG_SYSTEM_TEXT),
      makeMessage('assistant', 'greeting'),
      makeMessage('user', 'first input'),
    ];

    const plan = planTurns([firstTurn]);
    expect(plan.anchorIndexes).toEqual([1]);
    expect(plan.markingAnchorIndexes).toEqual([1]);
    expect(plan.nextState.anchorAdmissions).toEqual([
      {
        admitted: false,
        anchorIndex: 1,
        consecutiveSurvivals: 0,
        requiresValidation: false,
      },
    ]);

    // index 1은 assistant — llm-io가 문자열로 직렬화해 marker가 유실되므로 system(0)으로 물러난다.
    expect(breakpointIndexes(markCacheBreakpoints(firstTurn, plan))).toEqual([0]);
  });

  it('프리픽스가 최소 캐시 토큰 미만이면 마킹하지 않는다', () => {
    const messages = [makeMessage('system', 'short'), makeMessage('user', 'hi')];

    expect(markedIndexesOfLastTurn([messages, messages, messages])).toEqual([]);
  });

  it('한국어 프리픽스는 문자수/4 근사보다 후하게 추정해 마킹한다', () => {
    // 2,100자 한글 ≈ 1,050토큰(2자/토큰) — 구 근사(/4)로는 529토큰이라 생략되던 케이스.
    const messages = [makeMessage('system', '한'.repeat(2100)), makeMessage('user', '질문')];

    expect(markedIndexesOfLastTurn([messages, messages, messages])).toEqual([0]);
  });

  it('이미지 patch 토큰을 최소 cacheable prefix 판정에 포함한다', () => {
    const imageMessage: LlmMessage = {
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'url', url: 'data:image/png;base64,abc' },
          width: 1024,
          height: 1024,
        },
      ],
    };

    const fingerprint = fingerprintMessage(imageMessage);
    expect(fingerprint.tokenEstimate).toBe(1028);
    expect(fingerprint.textTokenEstimate).toBe(4);
    expect(
      markedIndexesOfLastTurn([
        [imageMessage, makeMessage('assistant', 'reply'), makeMessage('user', 'next')],
      ]),
    ).toEqual([0]);
  });

  it('크기를 모르는 이미지는 Base64 길이로 토큰을 추측하지 않는다', () => {
    const fingerprint = fingerprintMessage({
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'url', url: `data:image/png;base64,${'A'.repeat(20_000)}` },
        },
      ],
    });

    expect(fingerprint.tokenEstimate).toBe(4);
    expect(fingerprint.textTokenEstimate).toBe(4);
  });

  it('이미지와 텍스트가 섞이면 마지막 텍스트에 breakpoint를 붙인다', () => {
    const mixedMessage: LlmMessage = {
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'url', url: 'data:image/png;base64,abc' },
          width: 1024,
          height: 1024,
        },
        { type: 'text', text: 'describe' },
      ],
    };
    const messages = [mixedMessage, makeMessage('assistant', 'reply'), makeMessage('user', 'next')];
    const plan = planTurns([messages]);
    const [markedMessage] = markCacheBreakpoints(messages, plan);
    const [imagePart, textPart] = markedMessage.content;
    if (imagePart.type !== 'image' || textPart.type !== 'text') {
      throw new Error('Expected image-first mixed content');
    }

    expect(imagePart.cacheBreakpoint).toBeUndefined();
    expect(textPart.cacheBreakpoint).toEqual({ mode: 'explicit' });
  });

  it('16K 신규 쓰기 제한은 이미지 patch 토큰을 제외한다', () => {
    const imageMessage: LlmMessage = {
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'url', url: 'data:image/png;base64,abc' },
          width: 32_768,
          height: 32_768,
        },
      ],
    };

    const messages = [imageMessage, makeMessage('assistant', 'reply'), makeMessage('user', 'next')];
    const plan = planTurns([messages]);
    expect(plan.nextState.fingerprints[0].tokenEstimate).toBeGreaterThan(16_384);
    expect(plan.nextState.fingerprints[0].textTokenEstimate).toBe(4);
    expect(plan.nextState.anchorAdmissions[0].requiresValidation).toBe(false);
  });

  it('16k 이하 append-only 성장은 새 frontier를 즉시 마킹한다', () => {
    const firstTurn = [makeMessage('system', LONG_SYSTEM_TEXT), makeMessage('user', 'input 1')];
    const secondTurn = [
      ...firstTurn,
      makeMessage('assistant', 'reply 1'),
      makeMessage('user', 'input 2'),
    ];
    const thirdTurn = [
      ...secondTurn,
      makeMessage('assistant', 'reply 2'),
      makeMessage('user', 'input 3'),
    ];
    const fourthTurn = [
      ...thirdTurn,
      makeMessage('assistant', 'reply 3'),
      makeMessage('user', 'input 4'),
    ];

    expect(markedIndexesOfLastTurn([firstTurn, secondTurn])).toEqual([0, 3]);
    expect(markedIndexesOfLastTurn([firstTurn, secondTurn, thirdTurn])).toEqual([0, 3, 5]);
    expect(markedIndexesOfLastTurn([firstTurn, secondTurn, thirdTurn, fourthTurn])).toEqual([
      0, 3, 5, 7,
    ]);
  });

  it('16k 이하 중간 삽입형도 후행 블록 직전 frontier를 즉시 마킹한다', () => {
    const trailingBlock = makeMessage('system', 'post history instruction');
    const firstTurn = [
      makeMessage('system', LONG_SYSTEM_TEXT),
      makeMessage('user', 'input 1'),
      trailingBlock,
    ];
    const secondTurn = [
      makeMessage('system', LONG_SYSTEM_TEXT),
      makeMessage('user', 'input 1'),
      makeMessage('assistant', 'reply 1'),
      makeMessage('user', 'input 2'),
      trailingBlock,
    ];

    expect(markedIndexesOfLastTurn([firstTurn, secondTurn])).toEqual([0, 3]);
    expect(markedIndexesOfLastTurn([firstTurn, secondTurn, secondTurn])).toEqual([0, 3]);
    expect(markedIndexesOfLastTurn([firstTurn, secondTurn, secondTurn, secondTurn])).toEqual([
      0, 3,
    ]);
  });

  it('직전 요청과 동일하면(리롤) 현재 길이 안의 기존 앵커를 유지한다', () => {
    const messages = [
      makeMessage('system', LONG_SYSTEM_TEXT),
      makeMessage('user', 'stable input'),
      makeMessage('user', 'first input'),
    ];
    const rerollTurn = messages.map((message) => ({ ...message }));

    const plan = planTurns([messages, rerollTurn]);
    expect(plan.anchorIndexes).toEqual([1]);
  });

  it('요청이 직전의 프리픽스로 축소되면 첫 턴 정책으로 재추정한다', () => {
    const firstTurn = [makeMessage('system', LONG_SYSTEM_TEXT), makeMessage('user', 'input 1')];
    const secondTurn = [
      ...firstTurn,
      makeMessage('assistant', 'reply 1'),
      makeMessage('user', 'input 2'),
    ];
    const shrunkenTurn = [...firstTurn];

    const plan = planTurns([firstTurn, secondTurn, shrunkenTurn]);
    expect(plan.anchorIndexes).toEqual([0]);
  });

  it('공통 프리픽스가 없으면(채팅방 전환) 새 epoch로 초기화한다', () => {
    const roomATurn1 = [
      makeMessage('system', LONG_SYSTEM_TEXT),
      makeMessage('user', 'room A input 1'),
    ];
    const roomATurn2 = [
      makeMessage('system', LONG_SYSTEM_TEXT),
      makeMessage('user', 'edited room A input'),
    ];
    const roomBTurn = [
      makeMessage('system', `room B ${LONG_SYSTEM_TEXT}`),
      makeMessage('assistant', 'room B greeting'),
      makeMessage('user', 'room B input'),
    ];

    const plan = planTurns([roomATurn1, roomATurn2, roomBTurn]);
    expect(plan.anchorIndexes).toEqual([1]);
    expect(plan.nextState.anchorIndexes).toEqual([1]);
  });

  it('일치 프리픽스 안의 기존 앵커를 생존시키고 새 frontier를 증분 추가한다', () => {
    const firstTurn = [makeMessage('system', LONG_SYSTEM_TEXT), makeMessage('user', 'input 1')];
    const secondTurn = [...firstTurn, makeMessage('user', 'input 2')];
    const thirdTurn = [...secondTurn, makeMessage('user', 'input 3')];

    expect(planTurns([firstTurn, secondTurn]).anchorIndexes).toEqual([0, 2]);
    expect(planTurns([firstTurn, secondTurn, thirdTurn]).anchorIndexes).toEqual([0, 2, 3]);
  });

  it('분기 시 범위를 벗어난 앵커를 버리고 일치 경계와 새 frontier를 추가한다', () => {
    const firstTurn = [
      makeMessage('system', LONG_SYSTEM_TEXT),
      makeMessage('user', 'stable input'),
      makeMessage('user', 'input 1'),
    ];
    const secondTurn = [
      ...firstTurn,
      makeMessage('assistant', 'reply 1'),
      makeMessage('user', 'input 2'),
    ];
    const divergedTurn = [
      makeMessage('system', LONG_SYSTEM_TEXT),
      makeMessage('user', 'stable input'),
      makeMessage('user', 'input 1'),
      makeMessage('assistant', 'edited reply'),
      makeMessage('user', 'input 3'),
    ];

    const plan = planTurns([firstTurn, secondTurn, divergedTurn]);
    expect(plan.anchorIndexes).toEqual([1, 2, 4]);
    expect(plan.markingAnchorIndexes).toEqual([1, 2, 4]);
    expect(plan.nextState.anchorAdmissions).toContainEqual({
      admitted: false,
      anchorIndex: 2,
      consecutiveSurvivals: 0,
      requiresValidation: false,
    });
    expect(breakpointIndexes(markCacheBreakpoints(divergedTurn, plan))).toEqual([1, 2, 4]);
  });

  it('5개 후보는 토큰 간격이 가장 좁은 내부 앵커를 제거해 경계 2개를 보존한다', () => {
    const previousMessages = [
      makeMessage('system', LONG_SYSTEM_TEXT),
      makeMessage('user', 'A'.repeat(400)),
      makeMessage('user', 'B'.repeat(400)),
      makeMessage('user', ''),
      makeMessage('user', ''),
      makeMessage('user', 'C'.repeat(400)),
      makeMessage('user', 'D'.repeat(400)),
    ];
    const previousState: CacheAnchorState = {
      anchorAdmissions: [],
      anchorIndexes: [0, 2, 4, 6],
      consecutiveEpochResets: 0,
      consecutiveFrontierDeaths: 0,
      fingerprints: previousMessages.map(fingerprintMessage),
    };
    const currentMessages = [...previousMessages, makeMessage('user', 'E'.repeat(4000))];

    const plan = planCacheAnchors(previousState, currentMessages);

    expect(plan.anchorIndexes).toEqual([0, 2, 6, 7]);
  });

  it('최대 4개로 정규화된 안전 앵커를 모두 마킹한다', () => {
    const firstTurn = [makeMessage('system', LONG_SYSTEM_TEXT), makeMessage('user', 'input 1')];
    const secondTurn = [...firstTurn, makeMessage('user', 'input 2')];
    const thirdTurn = [...secondTurn, makeMessage('user', 'input 3')];
    const fourthTurn = [...thirdTurn, makeMessage('user', 'input 4')];

    expect(markedIndexesOfLastTurn([firstTurn, secondTurn, thirdTurn, fourthTurn])).toEqual([
      0, 2, 3, 4,
    ]);
  });

  it('마킹된 breakpoint가 실제 요청 body까지 직렬화된다', () => {
    const firstTurn = [
      makeMessage('system', LONG_SYSTEM_TEXT),
      makeMessage('assistant', 'greeting'),
      makeMessage('user', 'first input'),
    ];
    const plan = planTurns([firstTurn, firstTurn, firstTurn]);
    const marked = markCacheBreakpoints([...firstTurn], plan);

    const format = new OpenAIChatCompletionsFormat({ model: 'gpt-5.6-sol' });
    const body = format.createRequestBody({ messages: marked });

    expect(JSON.stringify(body)).toContain('prompt_cache_breakpoint');
  });

  it('입력 메시지를 변경하지 않고 새 배열을 반환한다', () => {
    const messages = [
      makeMessage('system', LONG_SYSTEM_TEXT),
      makeMessage('assistant', 'greeting'),
      makeMessage('user', 'first input'),
    ];

    const plan = planTurns([messages, messages, messages]);
    const marked = markCacheBreakpoints(messages, plan);

    expect(marked).not.toBe(messages);
    expect(breakpointIndexes(messages)).toEqual([]);
  });

  it('공통 프리픽스 0 epoch가 3회 연속이면 백오프를 발동해 마킹을 멈춘다', () => {
    const turns = ['A', 'B', 'C', 'D'].map((prefix) => [
      makeMessage('system', `${prefix}${LONG_SYSTEM_TEXT}`),
      makeMessage('user', 'input'),
    ]);
    let state: CacheAnchorState | null = null;
    const resetCounts: number[] = [];

    for (const turn of turns) {
      const plan = planCacheAnchors(state, turn);
      resetCounts.push(plan.nextState.consecutiveEpochResets);
      state = plan.nextState;
    }

    expect(resetCounts).toEqual([0, 1, 2, CACHE_BACKOFF_EPOCH_RESET_THRESHOLD]);
    expect(isCacheBackoffActive(state)).toBe(true);
    const lastTurn = turns[turns.length - 1];
    const backoffPlan = planCacheAnchors(planTurns(turns.slice(0, -1)).nextState, lastTurn);
    expect(breakpointIndexes(markCacheBreakpoints(lastTurn, backoffPlan))).toEqual([]);
  });

  it('백오프 중 공통 프리픽스가 돌아오면 카운터를 리셋하고 즉시 재개한다', () => {
    const changingTurns = ['A', 'B', 'C', 'D'].map((prefix) => [
      makeMessage('system', `${prefix}${LONG_SYSTEM_TEXT}`),
      makeMessage('user', 'input'),
    ]);
    const activeState = planTurns(changingTurns).nextState;
    const stableTurn = [...changingTurns[changingTurns.length - 1]];
    const recoveredPlan = planCacheAnchors(activeState, stableTurn);

    expect(recoveredPlan.nextState.consecutiveEpochResets).toBe(0);
    expect(isCacheBackoffActive(recoveredPlan.nextState)).toBe(false);
    expect(breakpointIndexes(markCacheBreakpoints(stableTurn, recoveredPlan))).toEqual([0]);
  });
});

describe('anchor admission', () => {
  it('16k를 넘는 첫 prefix는 즉시 쓰지 않고 한 번 생존하면 admission한다', () => {
    const messages = [
      makeMessage('system', 'L'.repeat(80_000)),
      makeMessage('user', 'current input'),
    ];

    const firstPlan = planTurns([messages]);
    const onceSurvivedPlan = planTurns([messages, messages]);

    expect(firstPlan.markingAnchorIndexes).toEqual([]);
    expect(onceSurvivedPlan.nextState.anchorAdmissions).toEqual([
      {
        admitted: true,
        anchorIndex: 0,
        consecutiveSurvivals: 2,
        requiresValidation: true,
      },
    ]);
    expect(onceSurvivedPlan.markingAnchorIndexes).toEqual([0]);
  });

  it('v0.8에서 생존 1회로 저장된 후보를 다음 요청에서 호환 승격한다', () => {
    const messages = [
      makeMessage('system', 'L'.repeat(80_000)),
      makeMessage('user', 'current input'),
    ];
    const firstPlan = planTurns([messages]);
    const previousState: CacheAnchorState = {
      ...firstPlan.nextState,
      anchorAdmissions: [
        {
          admitted: false,
          anchorIndex: 0,
          consecutiveSurvivals: 1,
          requiresValidation: true,
        },
      ],
    };

    const plan = planCacheAnchors(previousState, messages);

    expect(plan.nextState.anchorAdmissions).toEqual([
      {
        admitted: true,
        anchorIndex: 0,
        consecutiveSurvivals: 2,
        requiresValidation: true,
      },
    ]);
    expect(plan.markingAnchorIndexes).toEqual([0]);
  });

  it('구조적 성장으로 기존 frontier가 죽으면 16k 이하 신규 앵커도 검증한다', () => {
    const firstTurn = [
      makeMessage('system', LONG_SYSTEM_TEXT),
      makeMessage('user', 'stable input'),
      makeMessage('user', 'old frontier'),
    ];
    const structurallyChangedTurn = [
      makeMessage('system', LONG_SYSTEM_TEXT),
      makeMessage('assistant', 'inserted branch'),
      makeMessage('user', 'stable input'),
      makeMessage('user', 'new frontier'),
    ];

    const plan = planTurns([firstTurn, structurallyChangedTurn]);

    expect(plan.nextState.consecutiveFrontierDeaths).toBe(1);
    expect(plan.nextState.anchorAdmissions).toEqual([
      {
        admitted: false,
        anchorIndex: 0,
        consecutiveSurvivals: 0,
        requiresValidation: true,
      },
      {
        admitted: false,
        anchorIndex: 3,
        consecutiveSurvivals: 0,
        requiresValidation: true,
      },
    ]);
    expect(plan.markingAnchorIndexes).toEqual([]);
  });
});

describe('frontier death monitor', () => {
  const trimHead = makeMessage('system', LONG_SYSTEM_TEXT);
  const turnPair = (turnNumber: number): LlmMessage[] => [
    makeMessage('user', `input ${turnNumber} `.repeat(20)),
    makeMessage('assistant', `reply ${turnNumber} `.repeat(60)),
  ];
  // 포화 트림 정상상태: 가장 오래된 턴이 잘리고 새 턴이 붙어 메시지 수가 같다.
  const trimmedWindow = (startTurn: number): LlmMessage[] => [
    trimHead,
    ...[startTurn, startTurn + 1, startTurn + 2].flatMap(turnPair),
    makeMessage('user', `current input ${startTurn}`),
  ];

  it('개수 유지 시프트가 2연속이면 새 frontier 마킹만 보류한다', () => {
    const plan = planTurns([
      trimmedWindow(1),
      trimmedWindow(2),
      trimmedWindow(3),
      trimmedWindow(4),
    ]);

    expect(plan.nextState.consecutiveFrontierDeaths).toBe(3);
    expect(plan.markingAnchorIndexes).toEqual([0]);
  });

  it('같은 개수의 제자리 교체(리롤·in-place 수정)는 스트라이크를 세지 않는다', () => {
    const base = [trimHead, ...turnPair(1), ...turnPair(2), makeMessage('user', 'current input')];
    const editReplyOne = [...base];
    editReplyOne[2] = makeMessage('assistant', 'edited reply 1 '.repeat(50));
    const editReplyTwo = [...editReplyOne];
    editReplyTwo[4] = makeMessage('assistant', 'edited reply 2 '.repeat(50));

    const plan = planTurns([base, editReplyOne, editReplyTwo]);

    expect(plan.nextState.consecutiveFrontierDeaths).toBe(0);
    expect(plan.markingAnchorIndexes).toEqual([1, 2, 4]);
  });

  it('frontier가 살아남는 턴이 오면 카운터를 리셋하고 마킹을 재개한다', () => {
    const monitored = trimmedWindow(3);
    const survivedGrowth = [
      ...monitored,
      makeMessage('assistant', 'reply to current '.repeat(40)),
      makeMessage('user', 'next input'),
    ];

    const plan = planTurns([trimmedWindow(1), trimmedWindow(2), monitored, survivedGrowth]);

    expect(plan.nextState.consecutiveFrontierDeaths).toBe(0);
    expect(plan.markingAnchorIndexes).toEqual([0, 7, 9]);
  });

  it('구버전 anchor state는 frontier 사망 카운터를 0으로 마이그레이션한다', async () => {
    const legacyState = {
      anchorIndexes: [0],
      consecutiveEpochResets: 1,
      fingerprints: [fingerprintMessage(makeMessage('system', 'legacy'))],
    };
    vi.stubGlobal('risuai', {
      pluginStorage: {
        getItem: async () => JSON.stringify(legacyState),
      },
    });

    const state = await loadCacheAnchorState();

    expect(state?.consecutiveFrontierDeaths).toBe(0);
    expect(state?.consecutiveEpochResets).toBe(1);
  });
});

describe('prompt cache orchestration', () => {
  it('prepare 저장소 읽기 실패는 원본 messages와 extra body를 유지하고 commit을 만들지 않는다', async () => {
    const storageError = new Error('cache storage unavailable');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal('risuai', {
      pluginStorage: {
        getItem: async () => {
          throw storageError;
        },
      },
    });
    const messages = [makeMessage('system', LONG_SYSTEM_TEXT), makeMessage('user', 'input')];

    const prepared = await preparePromptCacheRequest(messages, 'explicit');

    expect(prepared.requestMessages).toBe(messages);
    expect(prepared.pendingCommit).toBeNull();
    expect(prepared.cacheExtraBody).toEqual({
      prompt_cache_key: EXPLICIT_PROMPT_CACHE_KEY,
      prompt_cache_options: { mode: 'explicit', ttl: '30m' },
    });
    expect(consoleError).toHaveBeenCalledWith(
      '[llm-gateway-provider] cache anchor handling failed; sending without breakpoints',
      storageError,
    );
  });

  it('commit 저장 실패는 throw하지 않고 transition을 반환하지 않는다', async () => {
    const storageError = new Error('cache storage unavailable');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal('risuai', {
      pluginStorage: {
        getItem: async () => null,
        setItem: async () => {
          throw storageError;
        },
      },
    });
    const prepared = await preparePromptCacheRequest(
      [makeMessage('system', LONG_SYSTEM_TEXT), makeMessage('user', 'input')],
      'explicit',
    );
    if (prepared.pendingCommit === null) {
      throw new Error('Expected prepare to create a pending commit');
    }

    await expect(commitPromptCacheState(prepared.pendingCommit)).resolves.toBeNull();
    expect(consoleError).toHaveBeenCalledWith(
      '[llm-gateway-provider] cache anchor state update failed',
      storageError,
    );
  });

  it('disabled 모드도 pending commit을 만들고 성공 뒤 diff 상태를 저장한다', async () => {
    const stored = new Map<string, string>();
    vi.stubGlobal('risuai', {
      pluginStorage: {
        getItem: async (key: string) => stored.get(key) ?? null,
        setItem: async (key: string, value: string) => {
          stored.set(key, value);
        },
      },
    });
    const messages = [makeMessage('system', LONG_SYSTEM_TEXT), makeMessage('user', 'input')];

    const prepared = await preparePromptCacheRequest(messages, 'disabled');

    expect(prepared.requestMessages).toBe(messages);
    if (prepared.pendingCommit === null) {
      throw new Error('Expected disabled mode to create a pending commit');
    }
    await expect(commitPromptCacheState(prepared.pendingCommit)).resolves.toBeNull();
    expect(stored.has(CACHE_ANCHOR_STATE_STORAGE_KEY)).toBe(true);
    await expect(loadCacheAnchorState()).resolves.toMatchObject({
      consecutiveEpochResets: 0,
    });
  });

  it.each([
    ['explicit', EXPLICIT_PROMPT_CACHE_KEY],
    ['disabled', DISABLED_PROMPT_CACHE_KEY],
  ] satisfies ReadonlyArray<readonly ['explicit' | 'disabled', string]>)(
    '%s prepare 실패도 원래 mode의 cache extra body를 유지한다',
    async (mode, promptCacheKey) => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      vi.stubGlobal('risuai', {
        pluginStorage: {
          getItem: async () => {
            throw new Error('cache storage unavailable');
          },
        },
      });

      const prepared = await preparePromptCacheRequest([], mode);

      expect(prepared.cacheExtraBody).toEqual({
        prompt_cache_key: promptCacheKey,
        prompt_cache_options: { mode: 'explicit', ttl: '30m' },
      });
      expect(prepared.pendingCommit).toBeNull();
    },
  );

  it('백오프 transition은 준비가 아니라 상태 저장 성공 뒤에 반환한다', async () => {
    const stored = new Map<string, string>();
    vi.stubGlobal('risuai', {
      pluginStorage: {
        getItem: async (key: string) => stored.get(key) ?? null,
        setItem: async (key: string, value: string) => {
          stored.set(key, value);
        },
      },
    });
    const changingTurns = ['A', 'B', 'C', 'D'].map((prefix) => [
      makeMessage('system', `${prefix}${LONG_SYSTEM_TEXT}`),
      makeMessage('user', 'input'),
    ]);
    let transition: CacheBackoffTransition | null = null;

    for (const turn of changingTurns) {
      const prepared = await preparePromptCacheRequest(turn, 'explicit');
      if (prepared.pendingCommit === null) {
        throw new Error('Expected prepare to create a pending commit');
      }
      transition = await commitPromptCacheState(prepared.pendingCommit);
    }

    expect(transition).toBe('activated');
    const stablePrepared = await preparePromptCacheRequest(
      [...changingTurns[changingTurns.length - 1]],
      'explicit',
    );
    if (stablePrepared.pendingCommit === null) {
      throw new Error('Expected prepare to create a pending commit');
    }
    await expect(commitPromptCacheState(stablePrepared.pendingCommit)).resolves.toBe('released');
  });
});

describe('cache anchor state storage', () => {
  it('저장한 상태를 다시 불러온다', async () => {
    const stored = new Map<string, string>();
    vi.stubGlobal('risuai', {
      pluginStorage: {
        getItem: async (key: string) => stored.get(key) ?? null,
        setItem: async (key: string, value: string) => {
          stored.set(key, value);
        },
      },
    });

    const plan = planCacheAnchors(null, [
      makeMessage('system', LONG_SYSTEM_TEXT),
      makeMessage('user', 'input'),
    ]);
    await saveCacheAnchorState(plan.nextState);

    expect(stored.has(CACHE_ANCHOR_STATE_STORAGE_KEY)).toBe(true);
    await expect(loadCacheAnchorState()).resolves.toEqual(plan.nextState);
  });

  it('카운터가 없는 구버전 앵커 상태를 0으로 마이그레이션한다', async () => {
    vi.stubGlobal('risuai', {
      pluginStorage: {
        getItem: async () =>
          JSON.stringify({
            anchorIndexes: [0],
            fingerprints: [{ role: 'system', hash: 'x', tokenEstimate: 1200 }],
          }),
      },
    });

    await expect(loadCacheAnchorState()).resolves.toMatchObject({
      anchorAdmissions: [],
      anchorIndexes: [0],
      consecutiveEpochResets: 0,
    });
  });

  it.each([
    null,
    '',
    '{broken json',
    '{"unexpected":"shape"}',
    '{"deepestDivergenceIndex":null,"fingerprints":[{"role":"system","hash":"x","tokenEstimate":1}],"frontierIndex":0}',
    '{"anchorIndexes":[1,0],"fingerprints":[{"role":"system","hash":"x","tokenEstimate":1},{"role":"user","hash":"y","tokenEstimate":1}]}',
  ])('저장 값이 %s이면 새 epoch(null)로 시작한다', async (raw) => {
    vi.stubGlobal('risuai', {
      pluginStorage: { getItem: async () => raw },
    });

    await expect(loadCacheAnchorState()).resolves.toBeNull();
  });
});
