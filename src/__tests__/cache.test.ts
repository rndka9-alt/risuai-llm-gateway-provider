import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAIChatCompletionsFormat, type LlmMessage } from 'llm-io';
import {
  CACHE_ANCHOR_STATE_STORAGE_KEY,
  DISABLED_PROMPT_CACHE_KEY,
  EXPLICIT_PROMPT_CACHE_KEY,
  createPromptCacheExtraBody,
  getPromptCacheKey,
  loadCacheAnchorState,
  markCacheBreakpoints,
  planCacheAnchors,
  resolvePromptCacheMode,
  saveCacheAnchorState,
  type CacheAnchorState,
  type CachePlan,
} from '../cache';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('prompt cache mode', () => {
  it('explicit 값만 explicit 모드로 판별한다', () => {
    expect(resolvePromptCacheMode('explicit')).toBe('explicit');
    expect(resolvePromptCacheMode(' explicit ')).toBe('explicit');
  });

  it.each([undefined, '', 'disabled', 'unknown'])('%s 값은 disabled 모드로 판별한다', (value) => {
    expect(resolvePromptCacheMode(value)).toBe('disabled');
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
  ] satisfies ReadonlyArray<readonly ['explicit' | 'disabled', string]>) (
    '%s 모드에 explicit 캐시 옵션과 해당 키를 구성한다',
    (mode, promptCacheKey) => {
      expect(createPromptCacheExtraBody(mode)).toEqual({
        prompt_cache_key: promptCacheKey,
        prompt_cache_options: { mode: 'explicit' },
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
      (part) => part.type === 'text' && part.cacheBreakpoint !== undefined,
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
  it('첫 턴은 마지막 user 직전을 frontier로 잡고, assistant는 건너뛰어 마킹한다', () => {
    const firstTurn = [
      makeMessage('system', LONG_SYSTEM_TEXT),
      makeMessage('assistant', 'greeting'),
      makeMessage('user', 'first input'),
    ];

    const plan = planTurns([firstTurn]);
    expect(plan.frontierIndex).toBe(1);
    // index 1은 assistant — llm-io가 문자열로 직렬화해 marker가 유실되므로 system(0)으로 물러난다.
    expect(markedIndexesOfLastTurn([firstTurn])).toEqual([0]);
  });

  it('프리픽스가 최소 캐시 토큰 미만이면 마킹하지 않는다', () => {
    const messages = [makeMessage('system', 'short'), makeMessage('user', 'hi')];

    expect(markedIndexesOfLastTurn([messages])).toEqual([]);
  });

  it('한국어 프리픽스는 문자수/4 근사보다 후하게 추정해 마킹한다', () => {
    // 2,100자 한글 ≈ 1,050토큰(2자/토큰) — 구 근사(/4)로는 529토큰이라 생략되던 케이스.
    const messages = [makeMessage('system', '한'.repeat(2100)), makeMessage('user', '질문')];

    expect(markedIndexesOfLastTurn([messages])).toEqual([0]);
  });

  it('append-only 성장이면 요청 끝에 frontier를 찍는다', () => {
    const firstTurn = [makeMessage('system', LONG_SYSTEM_TEXT), makeMessage('user', 'input 1')];
    const secondTurn = [
      ...firstTurn,
      makeMessage('assistant', 'reply 1'),
      makeMessage('user', 'input 2'),
    ];

    expect(markedIndexesOfLastTurn([firstTurn, secondTurn])).toEqual([3]);
  });

  it('중간 삽입형이면 공통 서픽스(후행 블록) 직전에 frontier를 찍는다', () => {
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

    expect(markedIndexesOfLastTurn([firstTurn, secondTurn])).toEqual([3]);
  });

  it('직전 요청과 동일하면(리롤) 이전 frontier 위치를 유지한다', () => {
    const messages = [
      makeMessage('system', LONG_SYSTEM_TEXT),
      makeMessage('user', 'stable input'),
      makeMessage('user', 'first input'),
    ];
    const rerollTurn = messages.map((message) => ({ ...message }));

    const plan = planTurns([messages, rerollTurn]);
    expect(plan.frontierIndex).toBe(1);
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
    expect(plan.frontierIndex).toBe(0);
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

    // 방 A의 분기로 deepestDivergenceIndex가 생긴 상태에서 방 B로 전환한다.
    const plan = planTurns([roomATurn1, roomATurn2, roomBTurn]);
    expect(plan.frontierIndex).toBe(1);
    expect(plan.fallbackIndex).toBeNull();
    expect(plan.nextState.deepestDivergenceIndex).toBeNull();
  });

  it('안정 구간이 깨지면 분기 지점을 폴백 앵커로 남긴다', () => {
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
      makeMessage('user', 'edited input'),
      makeMessage('user', 'input 3'),
    ];

    expect(markedIndexesOfLastTurn([firstTurn, secondTurn, divergedTurn])).toEqual([1, 3]);
  });

  it('마킹된 breakpoint가 실제 요청 body까지 직렬화된다', () => {
    const firstTurn = [
      makeMessage('system', LONG_SYSTEM_TEXT),
      makeMessage('assistant', 'greeting'),
      makeMessage('user', 'first input'),
    ];
    const plan = planTurns([firstTurn]);
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

    const plan = planCacheAnchors(null, messages);
    const marked = markCacheBreakpoints(messages, plan);

    expect(marked).not.toBe(messages);
    expect(breakpointIndexes(messages)).toEqual([]);
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

  it.each([
    null,
    '',
    '{broken json',
    '{"unexpected":"shape"}',
    '{"deepestDivergenceIndex":null,"fingerprints":[{"role":"invalid","hash":"x","tokenEstimate":1}],"frontierIndex":null}',
  ])(
    '저장 값이 %s이면 새 epoch(null)로 시작한다',
    async (raw) => {
      vi.stubGlobal('risuai', {
        pluginStorage: { getItem: async () => raw },
      });

      await expect(loadCacheAnchorState()).resolves.toBeNull();
    },
  );
});
