import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAIChatCompletionsFormat, type LlmMessage } from 'llm-io';
import {
  BANK_MAX_STATES,
  CACHE_ANCHOR_BANK_SLOT_STORAGE_KEY_PREFIX,
  CACHE_ANCHOR_STATE_STORAGE_KEY,
  CACHE_BACKOFF_BANK_MISS_THRESHOLD,
  DISABLED_PROMPT_CACHE_KEY,
  EXPLICIT_PROMPT_CACHE_KEY,
} from '../cache/constants';
import {
  commitPromptCacheState,
  isCacheBackoffActive,
  loadCacheAnchorBankMissCount,
  preparePromptCacheRequest,
  resolvePromptCacheMode,
  type CacheBackoffTransition,
} from '../cache';
import { markCacheBreakpoints } from '../cache/breakpoint/mark-cache-breakpoints';
import { getPromptCacheKey } from '../cache/mode/get-prompt-cache-key';
import { fingerprintMessage } from '../cache/planner/fingerprint-message';
import { planCacheAnchors } from '../cache/planner/plan-cache-anchors';
import { loadCacheAnchorState } from '../cache/state/load-cache-anchor-state';
import { saveCacheAnchorState } from '../cache/state/save-cache-anchor-state';
import type { CacheAnchorState } from '../cache/state/schema';
import type { CachePlan } from '../cache/types';

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

function cacheAnchorBankSlotKey(slot: number): string {
  return `${CACHE_ANCHOR_BANK_SLOT_STORAGE_KEY_PREFIX}${slot}`;
}

function createStoredAnchorState(messages: readonly LlmMessage[]): CacheAnchorState {
  const state = planCacheAnchors(null, messages).nextState;
  return {
    anchorAdmissions: state.anchorAdmissions,
    anchorIndexes: state.anchorIndexes,
    consecutiveFrontierDeaths: state.consecutiveFrontierDeaths,
    fingerprints: state.fingerprints,
  };
}

function seedCacheAnchorBank(
  stored: Map<string, string>,
  statesBySlot: ReadonlyMap<number, CacheAnchorState>,
  lruSlots: readonly number[],
  consecutiveBankMisses = 0,
): void {
  stored.set(
    CACHE_ANCHOR_STATE_STORAGE_KEY,
    JSON.stringify({ version: 1, consecutiveBankMisses, lruSlots }),
  );
  statesBySlot.forEach((state, slot) => {
    stored.set(cacheAnchorBankSlotKey(slot), JSON.stringify(state));
  });
}

describe('planCacheAnchors / markCacheBreakpoints', () => {
  it('정속 append로 앵커가 포화돼도 직전 frontier 앵커를 유지한다', () => {
    // exact-match 계약에서 직전 턴에 write한 frontier 엔트리는 이번 요청에 같은
    // 지점 마커가 있어야만 read된다. 직전 frontier가 축출되면 read 체인이 끊겨
    // 매턴 대형 re-write가 발생한다 (60턴 append 실측 eff 21.2% → 보호 후 86.7%).
    const messages: LlmMessage[] = [
      makeMessage('system', LONG_SYSTEM_TEXT),
      makeMessage('user', 'user turn 1'),
    ];
    const turns: (readonly LlmMessage[])[] = [[...messages]];
    for (let turn = 2; turn <= 9; turn += 1) {
      messages.push(
        makeMessage('assistant', `assistant reply ${turn - 1} `.repeat(60)),
        makeMessage('user', `user turn ${turn} `.repeat(30)),
      );
      turns.push([...messages]);
    }

    let state: CacheAnchorState | null = null;
    let previousFrontierIndex: number | null = null;
    for (const turn of turns) {
      const plan = planCacheAnchors(state, turn);
      if (previousFrontierIndex !== null) {
        expect(plan.anchorIndexes).toContain(previousFrontierIndex);
      }
      previousFrontierIndex = plan.anchorIndexes.at(-1) ?? null;
      state = plan.nextState;
    }
  });

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

  it('bank miss가 3회 연속이면 백오프를 발동해 마킹을 멈춘다', async () => {
    const stored = new Map<string, string>();
    vi.stubGlobal('risuai', {
      pluginStorage: {
        getItem: async (key: string) => stored.get(key) ?? null,
        setItem: async (key: string, value: string) => {
          stored.set(key, value);
        },
      },
    });
    const turns = ['A', 'B', 'C', 'D'].map((prefix) => [
      makeMessage('system', `${prefix}${LONG_SYSTEM_TEXT}`),
      makeMessage('user', 'input'),
    ]);
    const missCounts: number[] = [];
    const markedIndexes: number[][] = [];
    const transitions: Array<CacheBackoffTransition | null> = [];

    for (const turn of turns.slice(0, CACHE_BACKOFF_BANK_MISS_THRESHOLD)) {
      const prepared = await preparePromptCacheRequest(turn, 'explicit');
      markedIndexes.push(breakpointIndexes(prepared.requestMessages));
      if (prepared.pendingCommit === null) throw new Error('Expected a pending commit');
      transitions.push(await commitPromptCacheState(prepared.pendingCommit));
      missCounts.push(await loadCacheAnchorBankMissCount());
    }

    expect(missCounts).toEqual([1, 2, CACHE_BACKOFF_BANK_MISS_THRESHOLD]);
    expect(markedIndexes).toEqual([[0], [0], []]);
    expect(transitions).toEqual([null, null, 'activated']);
    expect(isCacheBackoffActive(missCounts.at(-1) ?? 0)).toBe(true);
  });

  it('백오프 중 bank 매치가 돌아오면 카운터를 리셋하고 즉시 재개한다', async () => {
    const stored = new Map<string, string>();
    vi.stubGlobal('risuai', {
      pluginStorage: {
        getItem: async (key: string) => stored.get(key) ?? null,
        setItem: async (key: string, value: string) => {
          stored.set(key, value);
        },
      },
    });
    const changingTurns = ['A', 'B', 'C'].map((prefix) => [
      makeMessage('system', `${prefix}${LONG_SYSTEM_TEXT}`),
      makeMessage('user', 'input'),
    ]);
    for (const turn of changingTurns) {
      const prepared = await preparePromptCacheRequest(turn, 'explicit');
      if (prepared.pendingCommit === null) throw new Error('Expected a pending commit');
      await commitPromptCacheState(prepared.pendingCommit);
    }

    const stableTurn = [...changingTurns[changingTurns.length - 1]];
    const recovered = await preparePromptCacheRequest(stableTurn, 'explicit');
    if (recovered.pendingCommit === null) throw new Error('Expected a pending commit');

    expect(breakpointIndexes(recovered.requestMessages)).toEqual([0]);
    await expect(commitPromptCacheState(recovered.pendingCommit)).resolves.toBe('released');
    await expect(loadCacheAnchorBankMissCount()).resolves.toBe(0);
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
    expect(state).not.toHaveProperty('consecutiveEpochResets');
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
    await expect(loadCacheAnchorBankMissCount()).resolves.toBe(1);
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
    const changingTurns = ['A', 'B', 'C'].map((prefix) => [
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

describe('content-addressed cache anchor state bank', () => {
  it('bank 용량을 활성 방 실사용 상한 16개로 고정한다', () => {
    expect(BANK_MAX_STATES).toBe(16);
  });

  function stubMapStorage(stored: Map<string, string>): void {
    vi.stubGlobal('risuai', {
      pluginStorage: {
        getItem: async (key: string) => stored.get(key) ?? null,
        setItem: async (key: string, value: string) => {
          stored.set(key, value);
        },
      },
    });
  }

  async function prepareAndCommit(messages: LlmMessage[]): Promise<void> {
    const prepared = await preparePromptCacheRequest(messages, 'explicit');
    if (prepared.pendingCommit === null) throw new Error('Expected a pending commit');
    await commitPromptCacheState(prepared.pendingCommit);
  }

  function createMatureBankState(identity: string): CacheAnchorState {
    const messages = [
      makeMessage('system', `${identity} ${LONG_SYSTEM_TEXT}`),
      makeMessage('user', `${identity} input 1`),
      makeMessage('assistant', `${identity} reply 1`),
      makeMessage('user', `${identity} input 2`),
      makeMessage('assistant', `${identity} reply 2`),
      makeMessage('user', `${identity} input 3`),
      makeMessage('assistant', `${identity} reply 3`),
      makeMessage('user', `${identity} input 4`),
    ];
    return {
      ...createStoredAnchorState(messages),
      anchorAdmissions: [],
      anchorIndexes: [0, 2, 4, 6],
    };
  }

  it('가장 긴 fingerprint 공통 프리픽스 상태를 선택한다', async () => {
    const stored = new Map<string, string>();
    const common = makeMessage('system', LONG_SYSTEM_TEXT);
    const stateZeroMessages = [common, makeMessage('user', 'room zero stable')];
    const stateOneMessages = [common, makeMessage('user', 'room one stable')];
    seedCacheAnchorBank(
      stored,
      new Map([
        [0, createStoredAnchorState(stateZeroMessages)],
        [1, createStoredAnchorState(stateOneMessages)],
      ]),
      [1, 0],
    );
    stubMapStorage(stored);
    const current = [...stateZeroMessages, makeMessage('user', 'room zero next')];

    await prepareAndCommit(current);

    expect(JSON.parse(stored.get(CACHE_ANCHOR_STATE_STORAGE_KEY) ?? '')).toMatchObject({
      lruSlots: [0, 1],
    });
    expect(JSON.parse(stored.get(cacheAnchorBankSlotKey(0)) ?? '')).toMatchObject({
      fingerprints: current.map(fingerprintMessage),
    });
    expect(JSON.parse(stored.get(cacheAnchorBankSlotKey(1)) ?? '')).toMatchObject({
      fingerprints: stateOneMessages.map(fingerprintMessage),
    });
  });

  it('공통 프리픽스 길이가 같으면 가장 최근 상태를 선택한다', async () => {
    const stored = new Map<string, string>();
    const common = makeMessage('system', LONG_SYSTEM_TEXT);
    const oldMessages = [common, makeMessage('user', 'old room branch')];
    const recentMessages = [common, makeMessage('user', 'recent room branch')];
    seedCacheAnchorBank(
      stored,
      new Map([
        [0, createStoredAnchorState(oldMessages)],
        [1, createStoredAnchorState(recentMessages)],
      ]),
      [1, 0],
    );
    stubMapStorage(stored);
    const current = [common, makeMessage('user', 'tie branch')];

    await prepareAndCommit(current);

    expect(JSON.parse(stored.get(CACHE_ANCHOR_STATE_STORAGE_KEY) ?? '')).toMatchObject({
      lruSlots: [1, 0],
    });
    expect(JSON.parse(stored.get(cacheAnchorBankSlotKey(1)) ?? '')).toMatchObject({
      fingerprints: current.map(fingerprintMessage),
    });
    expect(JSON.parse(stored.get(cacheAnchorBankSlotKey(0)) ?? '')).toMatchObject({
      fingerprints: oldMessages.map(fingerprintMessage),
    });
  });

  it('1개 메시지도 매치하지 못하면 새 상태를 만든다', async () => {
    const stored = new Map<string, string>();
    const existingMessages = [
      makeMessage('system', `existing ${LONG_SYSTEM_TEXT}`),
      makeMessage('user', 'existing input'),
    ];
    seedCacheAnchorBank(stored, new Map([[0, createStoredAnchorState(existingMessages)]]), [0]);
    stubMapStorage(stored);
    const current = [
      makeMessage('system', `new ${LONG_SYSTEM_TEXT}`),
      makeMessage('user', 'new input'),
    ];

    await prepareAndCommit(current);

    expect(JSON.parse(stored.get(CACHE_ANCHOR_STATE_STORAGE_KEY) ?? '')).toMatchObject({
      consecutiveBankMisses: 1,
      lruSlots: [1, 0],
    });
    expect(JSON.parse(stored.get(cacheAnchorBankSlotKey(1)) ?? '')).toMatchObject({
      fingerprints: current.map(fingerprintMessage),
    });
  });

  it('1024 추정 토큰 미만 공통 프리픽스는 채택하지 않는다', async () => {
    const stored = new Map<string, string>();
    const sharedHeader = makeMessage('system', 'short shared header');
    const original = [sharedHeader, makeMessage('user', 'original room')];
    seedCacheAnchorBank(stored, new Map([[0, createStoredAnchorState(original)]]), [0]);
    stubMapStorage(stored);
    const current = [sharedHeader, makeMessage('user', `different room ${'D'.repeat(5_000)}`)];

    await prepareAndCommit(current);

    expect(JSON.parse(stored.get(CACHE_ANCHOR_STATE_STORAGE_KEY) ?? '')).toMatchObject({
      consecutiveBankMisses: 1,
      lruSlots: [1, 0],
    });
    expect(JSON.parse(stored.get(cacheAnchorBankSlotKey(0)) ?? '')).toMatchObject({
      fingerprints: original.map(fingerprintMessage),
    });
    expect(JSON.parse(stored.get(cacheAnchorBankSlotKey(1)) ?? '')).toMatchObject({
      fingerprints: current.map(fingerprintMessage),
    });
  });

  it('소형 방 연속 대화는 같은 슬롯을 갱신하고 miss 백오프를 누적하지 않는다', async () => {
    const stored = new Map<string, string>();
    const healthyRoom = [
      makeMessage('system', `healthy ${LONG_SYSTEM_TEXT}`),
      makeMessage('user', 'healthy input'),
    ];
    seedCacheAnchorBank(
      stored,
      new Map([[0, createStoredAnchorState(healthyRoom)]]),
      [0],
      CACHE_BACKOFF_BANK_MISS_THRESHOLD - 1,
    );
    stubMapStorage(stored);
    const system = makeMessage('system', 'small room header');
    const firstInput = makeMessage('user', 'small input one');
    const firstReply = makeMessage('assistant', 'small reply one');
    const secondInput = makeMessage('user', 'small input two');
    const secondReply = makeMessage('assistant', 'small reply two');
    const turns = [
      [system, firstInput],
      [system, firstInput, firstReply, secondInput],
      [system, firstInput, firstReply, secondInput, secondReply, makeMessage('user', 'third')],
    ];
    const transitions: Array<CacheBackoffTransition | null> = [];

    for (let turnIndex = 0; turnIndex < turns.length; turnIndex += 1) {
      const turn = turns[turnIndex];
      const prepared = await preparePromptCacheRequest(turn, 'explicit');
      expect(breakpointIndexes(prepared.requestMessages)).toEqual([]);
      if (prepared.pendingCommit === null) throw new Error('Expected a pending commit');
      transitions.push(await commitPromptCacheState(prepared.pendingCommit));
      if (turnIndex === 0) {
        expect(await loadCacheAnchorBankMissCount()).toBe(CACHE_BACKOFF_BANK_MISS_THRESHOLD - 1);
        expect(isCacheBackoffActive(await loadCacheAnchorBankMissCount())).toBe(false);
      }
    }

    expect(transitions).toEqual([null, null, null]);
    expect(await loadCacheAnchorBankMissCount()).toBe(0);
    expect(isCacheBackoffActive(await loadCacheAnchorBankMissCount())).toBe(false);
    expect(JSON.parse(stored.get(CACHE_ANCHOR_STATE_STORAGE_KEY) ?? '')).toEqual({
      version: 1,
      consecutiveBankMisses: 0,
      lruSlots: [1, 0],
    });
    expect(JSON.parse(stored.get(cacheAnchorBankSlotKey(1)) ?? '')).toMatchObject({
      fingerprints: turns[turns.length - 1].map(fingerprintMessage),
    });
    expect(JSON.parse(stored.get(cacheAnchorBankSlotKey(0)) ?? '')).toMatchObject({
      fingerprints: healthyRoom.map(fingerprintMessage),
    });
    expect(stored.has(cacheAnchorBankSlotKey(2))).toBe(false);
  });

  it('소형 방 miss는 만석 bank의 실그룹을 축출하거나 덮어쓰지 않는다', async () => {
    const stored = new Map<string, string>();
    const statesBySlot = new Map<number, CacheAnchorState>();
    for (let slot = 0; slot < BANK_MAX_STATES; slot += 1) {
      statesBySlot.set(slot, createMatureBankState(`full-room-${slot}`));
    }
    const initialLru = Array.from({ length: BANK_MAX_STATES }, (_, index) => index).reverse();
    seedCacheAnchorBank(stored, statesBySlot, initialLru);
    const storedBeforeRequest = new Map(stored);
    const setItem = vi.fn(async (key: string, value: string) => {
      stored.set(key, value);
    });
    vi.stubGlobal('risuai', {
      pluginStorage: {
        getItem: async (key: string) => stored.get(key) ?? null,
        setItem,
      },
    });
    const smallMiss = [
      makeMessage('system', 'unique small room'),
      makeMessage('user', 'small input'),
    ];

    const prepared = await preparePromptCacheRequest(smallMiss, 'explicit');

    expect(breakpointIndexes(prepared.requestMessages)).toEqual([]);
    if (prepared.pendingCommit === null) throw new Error('Expected a pending commit');
    await expect(commitPromptCacheState(prepared.pendingCommit)).resolves.toBeNull();
    expect(setItem).not.toHaveBeenCalled();
    expect(stored).toEqual(storedBeforeRequest);
    await expect(loadCacheAnchorBankMissCount()).resolves.toBe(0);
  });

  it('소형 방이 1024를 넘긴 뒤 다음 성장 턴부터 큰 그룹에 매치돼 마킹한다', async () => {
    const stored = new Map<string, string>();
    stubMapStorage(stored);
    const system = makeMessage('system', 'S'.repeat(3_000));
    const firstInput = makeMessage('user', 'first input');
    const small = [system, firstInput];
    const crossed = [
      ...small,
      makeMessage('assistant', 'A'.repeat(1_200)),
      makeMessage('user', 'second input'),
    ];
    const grown = [
      ...crossed,
      makeMessage('assistant', 'B'.repeat(200)),
      makeMessage('user', 'third input'),
    ];

    await prepareAndCommit(small);
    const crossedPrepared = await preparePromptCacheRequest(crossed, 'explicit');
    expect(breakpointIndexes(crossedPrepared.requestMessages)).toEqual([]);
    if (crossedPrepared.pendingCommit === null) throw new Error('Expected a pending commit');
    await commitPromptCacheState(crossedPrepared.pendingCommit);

    const grownPrepared = await preparePromptCacheRequest(grown, 'explicit');
    expect(breakpointIndexes(grownPrepared.requestMessages).length).toBeGreaterThan(0);
    if (grownPrepared.pendingCommit === null) throw new Error('Expected a pending commit');
    await commitPromptCacheState(grownPrepared.pendingCommit);

    expect(JSON.parse(stored.get(CACHE_ANCHOR_STATE_STORAGE_KEY) ?? '')).toEqual({
      version: 1,
      consecutiveBankMisses: 0,
      lruSlots: [1, 0],
    });
    expect(JSON.parse(stored.get(cacheAnchorBankSlotKey(1)) ?? '')).toMatchObject({
      fingerprints: grown.map(fingerprintMessage),
    });
    expect(stored.has(cacheAnchorBankSlotKey(2))).toBe(false);
  });

  it('bank miss 백오프 중에는 직전 miss 슬롯을 덮어써 슬롯 오염을 제한한다', async () => {
    const stored = new Map<string, string>();
    const healthyRoom = [
      makeMessage('system', `healthy ${LONG_SYSTEM_TEXT}`),
      makeMessage('user', 'healthy input'),
    ];
    seedCacheAnchorBank(stored, new Map([[0, createStoredAnchorState(healthyRoom)]]), [0]);
    stubMapStorage(stored);
    const churnTurns = ['one', 'two', 'three', 'four'].map((identity) => [
      makeMessage('system', `${identity} ${LONG_SYSTEM_TEXT}`),
      makeMessage('user', `${identity} input`),
    ]);

    for (const turn of churnTurns) await prepareAndCommit(turn);

    expect(JSON.parse(stored.get(CACHE_ANCHOR_STATE_STORAGE_KEY) ?? '')).toEqual({
      version: 1,
      consecutiveBankMisses: 4,
      lruSlots: [3, 2, 1, 0],
    });
    expect(stored.has(cacheAnchorBankSlotKey(4))).toBe(false);
    expect(JSON.parse(stored.get(cacheAnchorBankSlotKey(3)) ?? '')).toMatchObject({
      fingerprints: churnTurns[3].map(fingerprintMessage),
    });
    expect(JSON.parse(stored.get(cacheAnchorBankSlotKey(0)) ?? '')).toMatchObject({
      fingerprints: healthyRoom.map(fingerprintMessage),
    });

    await prepareAndCommit(healthyRoom);
    const afterRelease = [
      makeMessage('system', `after release ${LONG_SYSTEM_TEXT}`),
      makeMessage('user', 'after release input'),
    ];
    await prepareAndCommit(afterRelease);

    expect(JSON.parse(stored.get(CACHE_ANCHOR_STATE_STORAGE_KEY) ?? '')).toMatchObject({
      consecutiveBankMisses: 1,
      lruSlots: [4, 0, 3, 2, 1],
    });
    expect(JSON.parse(stored.get(cacheAnchorBankSlotKey(4)) ?? '')).toMatchObject({
      fingerprints: afterRelease.map(fingerprintMessage),
    });
  });

  it('얕은 그룹이 없으면 만석 bank의 순수 LRU 꼬리를 축출한다', async () => {
    const stored = new Map<string, string>();
    const statesBySlot = new Map<number, CacheAnchorState>();
    for (let slot = 0; slot < BANK_MAX_STATES; slot += 1) {
      statesBySlot.set(slot, createMatureBankState(`room-${slot}`));
    }
    const initialLru = Array.from({ length: BANK_MAX_STATES }, (_, index) => index).reverse();
    seedCacheAnchorBank(stored, statesBySlot, initialLru);
    stubMapStorage(stored);
    const current = [
      makeMessage('system', `overflow ${LONG_SYSTEM_TEXT}`),
      makeMessage('user', 'overflow input'),
    ];

    await prepareAndCommit(current);

    expect(JSON.parse(stored.get(CACHE_ANCHOR_STATE_STORAGE_KEY) ?? '')).toMatchObject({
      lruSlots: [0, ...initialLru.filter((slot) => slot !== 0)],
    });
    expect(JSON.parse(stored.get(cacheAnchorBankSlotKey(0)) ?? '')).toMatchObject({
      fingerprints: current.map(fingerprintMessage),
    });
  });

  it('만석 bank는 가장 오래된 1BP 이하 그룹을 성숙 그룹보다 먼저 축출한다', async () => {
    const stored = new Map<string, string>();
    const statesBySlot = new Map<number, CacheAnchorState>();
    for (let slot = 0; slot < BANK_MAX_STATES; slot += 1) {
      statesBySlot.set(slot, createMatureBankState(`room-${slot}`));
    }
    const oldestShallowState = statesBySlot.get(7);
    const recentShallowState = statesBySlot.get(8);
    if (oldestShallowState === undefined || recentShallowState === undefined) {
      throw new Error('Expected seeded shallow bank states.');
    }
    statesBySlot.set(7, {
      ...oldestShallowState,
      anchorAdmissions: [],
      anchorIndexes: [0],
    });
    statesBySlot.set(8, {
      ...recentShallowState,
      anchorAdmissions: [],
      anchorIndexes: [],
    });
    const initialLru = Array.from({ length: BANK_MAX_STATES }, (_, index) => index).reverse();
    seedCacheAnchorBank(stored, statesBySlot, initialLru);
    const oldestMatureRaw = stored.get(cacheAnchorBankSlotKey(0));
    stubMapStorage(stored);
    const current = [
      makeMessage('system', `overflow ${LONG_SYSTEM_TEXT}`),
      makeMessage('user', 'overflow input'),
    ];

    await prepareAndCommit(current);

    expect(JSON.parse(stored.get(CACHE_ANCHOR_STATE_STORAGE_KEY) ?? '')).toMatchObject({
      lruSlots: [7, ...initialLru.filter((slot) => slot !== 7)],
    });
    expect(stored.get(cacheAnchorBankSlotKey(0))).toBe(oldestMatureRaw);
    expect(JSON.parse(stored.get(cacheAnchorBankSlotKey(7)) ?? '')).toMatchObject({
      fingerprints: current.map(fingerprintMessage),
    });
    expect(JSON.parse(stored.get(cacheAnchorBankSlotKey(8)) ?? '')).toMatchObject({
      anchorIndexes: [],
    });
  });

  it('레거시 단일 키 상태를 첫 bank 엔트리로 성공 응답 뒤 이식한다', async () => {
    const stored = new Map<string, string>();
    const legacyMessages = [
      makeMessage('system', LONG_SYSTEM_TEXT),
      makeMessage('user', 'legacy input'),
    ];
    stored.set(
      CACHE_ANCHOR_STATE_STORAGE_KEY,
      JSON.stringify(createStoredAnchorState(legacyMessages)),
    );
    stubMapStorage(stored);
    const current = [
      makeMessage('system', `different room ${LONG_SYSTEM_TEXT}`),
      makeMessage('user', 'different room input'),
    ];

    await prepareAndCommit(current);

    expect(JSON.parse(stored.get(CACHE_ANCHOR_STATE_STORAGE_KEY) ?? '')).toEqual({
      version: 1,
      consecutiveBankMisses: 1,
      lruSlots: [1, 0],
    });
    expect(JSON.parse(stored.get(cacheAnchorBankSlotKey(0)) ?? '')).toMatchObject({
      fingerprints: legacyMessages.map(fingerprintMessage),
    });
    expect(JSON.parse(stored.get(cacheAnchorBankSlotKey(1)) ?? '')).toMatchObject({
      fingerprints: current.map(fingerprintMessage),
    });
    // 구버전 loader는 bank index를 state로 파싱하지 못해 무해하게 새 epoch로 간다.
    await expect(loadCacheAnchorState()).resolves.toBeNull();
  });

  it('frontier보다 얕은 이질 채택은 새 그룹으로 fork하고 원본을 보존한다', async () => {
    const stored = new Map<string, string>();
    const sharedHeader = makeMessage('system', LONG_SYSTEM_TEXT);
    const stableInput = makeMessage('user', 'stable input');
    const original = [
      sharedHeader,
      stableInput,
      makeMessage('assistant', 'original branch reply'),
      makeMessage('user', 'original branch continuation'),
    ];
    const unrelated = [
      makeMessage('system', `unrelated ${LONG_SYSTEM_TEXT}`),
      makeMessage('user', 'unrelated room'),
    ];
    seedCacheAnchorBank(
      stored,
      new Map([
        [0, createStoredAnchorState(original)],
        [5, createStoredAnchorState(unrelated)],
      ]),
      [5, 0],
    );
    const originalRaw = stored.get(cacheAnchorBankSlotKey(0));
    const unrelatedRaw = stored.get(cacheAnchorBankSlotKey(5));
    stubMapStorage(stored);
    const branch = [
      sharedHeader,
      stableInput,
      makeMessage('assistant', 'forked branch reply'),
      makeMessage('user', 'forked branch extra turn'),
      makeMessage('user', 'forked branch continuation'),
    ];

    await prepareAndCommit(branch);

    expect(JSON.parse(stored.get(CACHE_ANCHOR_STATE_STORAGE_KEY) ?? '')).toEqual({
      version: 1,
      consecutiveBankMisses: 0,
      lruSlots: [1, 5, 0],
    });
    expect(stored.get(cacheAnchorBankSlotKey(0))).toBe(originalRaw);
    expect(stored.get(cacheAnchorBankSlotKey(5))).toBe(unrelatedRaw);
    const forkedState = JSON.parse(stored.get(cacheAnchorBankSlotKey(1)) ?? '');
    expect(forkedState).toMatchObject({
      consecutiveFrontierDeaths: 0,
      fingerprints: branch.map(fingerprintMessage),
    });
    expect(forkedState.anchorIndexes).toContain(1);
    expect(forkedState.anchorIndexes).not.toContain(2);
    expect(forkedState.anchorAdmissions).not.toContainEqual(
      expect.objectContaining({ anchorIndex: 2 }),
    );
  });

  it('fork는 생존한 admitted 앵커의 admission 증거를 그대로 승계한다', async () => {
    const stored = new Map<string, string>();
    const sharedHeader = makeMessage('system', LONG_SYSTEM_TEXT);
    const stableInput = makeMessage('user', 'stable input');
    const original = [
      sharedHeader,
      stableInput,
      makeMessage('assistant', 'original reply'),
      makeMessage('user', 'original continuation'),
    ];
    const sourceState: CacheAnchorState = {
      ...createStoredAnchorState(original),
      anchorAdmissions: [
        {
          admitted: true,
          anchorIndex: 0,
          consecutiveSurvivals: 2,
          requiresValidation: true,
        },
      ],
      anchorIndexes: [0, 2],
    };
    seedCacheAnchorBank(stored, new Map([[0, sourceState]]), [0]);
    stubMapStorage(stored);
    const branch = [
      sharedHeader,
      stableInput,
      makeMessage('assistant', 'forked reply'),
      makeMessage('user', 'forked extra turn'),
      makeMessage('user', 'forked continuation'),
    ];

    await prepareAndCommit(branch);

    const forkedState = JSON.parse(stored.get(cacheAnchorBankSlotKey(1)) ?? '');
    expect(forkedState).toMatchObject({
      consecutiveFrontierDeaths: 0,
    });
    expect(forkedState.anchorAdmissions).toContainEqual({
      admitted: true,
      anchorIndex: 0,
      consecutiveSurvivals: 2,
      requiresValidation: true,
    });
  });

  it('fork는 진행 중 admission 후보를 이어받아 다음 생존에서 승격한다', async () => {
    const stored = new Map<string, string>();
    const sharedHeader = makeMessage('system', LONG_SYSTEM_TEXT);
    const stableInput = makeMessage('user', 'stable input');
    const original = [
      sharedHeader,
      stableInput,
      makeMessage('assistant', 'original reply'),
      makeMessage('user', 'original continuation'),
    ];
    const sourceState: CacheAnchorState = {
      ...createStoredAnchorState(original),
      anchorAdmissions: [
        {
          admitted: false,
          anchorIndex: 0,
          consecutiveSurvivals: 1,
          requiresValidation: true,
        },
      ],
      anchorIndexes: [0, 2],
    };
    seedCacheAnchorBank(stored, new Map([[0, sourceState]]), [0]);
    stubMapStorage(stored);
    const branch = [
      sharedHeader,
      stableInput,
      makeMessage('assistant', 'forked reply'),
      makeMessage('user', 'forked extra turn'),
      makeMessage('user', 'forked continuation'),
    ];

    await prepareAndCommit(branch);

    const forkedState = JSON.parse(stored.get(cacheAnchorBankSlotKey(1)) ?? '');
    expect(forkedState).toMatchObject({
      consecutiveFrontierDeaths: 0,
    });
    expect(forkedState.anchorAdmissions).toContainEqual({
      admitted: true,
      anchorIndex: 0,
      consecutiveSurvivals: 2,
      requiresValidation: true,
    });
  });

  it('같은 길이 비시프트 리롤은 fork 없이 기존 그룹을 제자리 갱신한다', async () => {
    const stored = new Map<string, string>();
    const original = [
      makeMessage('system', LONG_SYSTEM_TEXT),
      makeMessage('user', 'stable input'),
      makeMessage('assistant', 'original generated reply'),
      makeMessage('user', 'continue'),
    ];
    seedCacheAnchorBank(stored, new Map([[0, createStoredAnchorState(original)]]), [0]);
    stubMapStorage(stored);
    const reroll = [...original];
    reroll[2] = makeMessage('assistant', 'rerolled generated reply');

    await prepareAndCommit(reroll);

    expect(JSON.parse(stored.get(CACHE_ANCHOR_STATE_STORAGE_KEY) ?? '')).toEqual({
      version: 1,
      consecutiveBankMisses: 0,
      lruSlots: [0],
    });
    expect(stored.has(cacheAnchorBankSlotKey(1))).toBe(false);
    expect(JSON.parse(stored.get(cacheAnchorBankSlotKey(0)) ?? '')).toMatchObject({
      fingerprints: reroll.map(fingerprintMessage),
    });
  });

  it('fork된 두 브랜치를 왕복하면 양쪽 그룹에서 캐시 히트 마커를 유지한다', async () => {
    const stored = new Map<string, string>();
    stubMapStorage(stored);
    const sharedHeader = makeMessage('system', LONG_SYSTEM_TEXT);
    const stableInput = makeMessage('user', 'stable input');
    const branchA = [
      sharedHeader,
      stableInput,
      makeMessage('assistant', 'branch A reply'),
      makeMessage('user', 'branch A continuation'),
    ];
    const branchB = [
      sharedHeader,
      stableInput,
      makeMessage('assistant', 'branch B reply'),
      makeMessage('user', 'branch B extra turn'),
      makeMessage('user', 'branch B continuation'),
    ];

    await prepareAndCommit(branchA);
    await prepareAndCommit(branchB);

    const returnedA = await preparePromptCacheRequest([...branchA], 'explicit');
    expect(breakpointIndexes(returnedA.requestMessages).length).toBeGreaterThan(0);
    if (returnedA.pendingCommit === null) throw new Error('Expected a pending commit');
    await commitPromptCacheState(returnedA.pendingCommit);

    const returnedB = await preparePromptCacheRequest([...branchB], 'explicit');
    expect(breakpointIndexes(returnedB.requestMessages).length).toBeGreaterThan(0);
    if (returnedB.pendingCommit === null) throw new Error('Expected a pending commit');
    await commitPromptCacheState(returnedB.pendingCommit);

    expect(JSON.parse(stored.get(CACHE_ANCHOR_STATE_STORAGE_KEY) ?? '')).toMatchObject({
      consecutiveBankMisses: 0,
      lruSlots: [1, 0],
    });
    expect(JSON.parse(stored.get(cacheAnchorBankSlotKey(0)) ?? '')).toMatchObject({
      fingerprints: branchA.map(fingerprintMessage),
    });
    expect(JSON.parse(stored.get(cacheAnchorBankSlotKey(1)) ?? '')).toMatchObject({
      fingerprints: branchB.map(fingerprintMessage),
    });
  });

  it.each([
    '{broken json',
    JSON.stringify({ version: 1, consecutiveBankMisses: 2, lruSlots: [3] }),
  ])('손상되거나 슬롯이 사라진 bank(%s)는 빈 bank로 자가 회복한다', async (rawIndex) => {
    const stored = new Map([[CACHE_ANCHOR_STATE_STORAGE_KEY, rawIndex]]);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    stubMapStorage(stored);
    const current = [
      makeMessage('system', `recovered ${LONG_SYSTEM_TEXT}`),
      makeMessage('user', 'recovered input'),
    ];

    await expect(prepareAndCommit(current)).resolves.toBeUndefined();

    expect(JSON.parse(stored.get(CACHE_ANCHOR_STATE_STORAGE_KEY) ?? '')).toMatchObject({
      consecutiveBankMisses: 1,
      lruSlots: [0],
    });
  });

  it('fork 전이에서도 방별 frontier 사망 카운터를 독립 보존한다', async () => {
    const stored = new Map<string, string>();
    const roomWindow = (room: string, startTurn: number): LlmMessage[] => [
      makeMessage('system', `${room} ${LONG_SYSTEM_TEXT}`),
      ...[startTurn, startTurn + 1, startTurn + 2].flatMap((turn) => [
        makeMessage('user', `${room} input ${turn}`),
        makeMessage('assistant', `${room} reply ${turn}`),
      ]),
      makeMessage('user', `${room} current ${startTurn}`),
    ];
    const roomA = createStoredAnchorState(roomWindow('A', 1));
    const roomB = createStoredAnchorState(roomWindow('B', 1));
    seedCacheAnchorBank(
      stored,
      new Map([
        [0, { ...roomA, consecutiveFrontierDeaths: 1 }],
        [1, roomB],
      ]),
      [1, 0],
    );
    stubMapStorage(stored);

    await prepareAndCommit(roomWindow('A', 2));

    expect(JSON.parse(stored.get(cacheAnchorBankSlotKey(0)) ?? '')).toMatchObject({
      consecutiveFrontierDeaths: 1,
      fingerprints: roomA.fingerprints,
    });
    expect(JSON.parse(stored.get(cacheAnchorBankSlotKey(1)) ?? '')).toMatchObject({
      consecutiveFrontierDeaths: 0,
      fingerprints: roomB.fingerprints,
    });
    expect(JSON.parse(stored.get(cacheAnchorBankSlotKey(2)) ?? '')).toMatchObject({
      consecutiveFrontierDeaths: 0,
    });
  });

  it('첫 load 뒤에는 runtime snapshot으로 슬롯 read를 반복하지 않는다', async () => {
    const stored = new Map<string, string>();
    const getItem = vi.fn(async (key: string) => stored.get(key) ?? null);
    vi.stubGlobal('risuai', {
      pluginStorage: {
        getItem,
        setItem: async (key: string, value: string) => {
          stored.set(key, value);
        },
      },
    });
    const first = [makeMessage('system', LONG_SYSTEM_TEXT), makeMessage('user', 'first')];
    await prepareAndCommit(first);
    const readCountAfterFirstCommit = getItem.mock.calls.length;

    await prepareAndCommit([...first, makeMessage('user', 'second')]);

    expect(getItem).toHaveBeenCalledTimes(readCountAfterFirstCommit);
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
    await expect(loadCacheAnchorState()).resolves.toMatchObject({
      anchorAdmissions: plan.nextState.anchorAdmissions,
      anchorIndexes: plan.nextState.anchorIndexes,
      consecutiveFrontierDeaths: plan.nextState.consecutiveFrontierDeaths,
      fingerprints: plan.nextState.fingerprints,
    });
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
      consecutiveFrontierDeaths: 0,
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
