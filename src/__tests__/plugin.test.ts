import { afterEach, describe, expect, it, vi } from 'vitest';
import { CACHE_ANCHOR_STATE_STORAGE_KEY } from '../cache';
import { CACHE_LEDGER_STORAGE_KEY } from '../ledger';
import { RISUAI_LLM_FLAGS } from '../options';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

const LONG_SYSTEM_TEXT = 'S'.repeat(6000);

function createProviderArguments(
  systemText = LONG_SYSTEM_TEXT,
  includePenalties = true,
): ProviderArguments {
  const sharedArguments: ProviderArguments = {
    prompt_chat: [
      { role: 'system', content: systemText },
      { role: 'user', content: 'hello' },
    ],
    temperature: 1,
    max_tokens: 1000,
    min_p: 0,
    repetition_penalty: 0,
    top_k: 0,
    top_p: 1,
    mode: 'chat',
  };
  return includePenalties
    ? { ...sharedArguments, frequency_penalty: 0.25, presence_penalty: -0.5 }
    : sharedArguments;
}

function createSuccessfulResponse(): Response {
  return new Response(
    JSON.stringify({
      choices: [{ finish_reason: 'stop', message: { content: 'ok' } }],
      usage: { prompt_tokens: 1500 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function createStreamingResponse(
  textDeltas: readonly string[] = ['hel', 'lo'],
): Response {
  const serializedEvents = textDeltas.map((text) => `data: ${JSON.stringify({
    choices: [{ delta: { content: text }, index: 0 }],
  })}`);
  serializedEvents.push(`data: ${JSON.stringify({
    choices: [{ delta: {}, finish_reason: 'stop', index: 0 }],
  })}`);
  serializedEvents.push(`data: ${JSON.stringify({
    choices: [],
    usage: {
      completion_tokens: 2,
      cost: 0.01,
      prompt_tokens: 1500,
      prompt_tokens_details: { cache_write_tokens: 200, cached_tokens: 1200 },
      total_tokens: 1502,
    },
  })}`);
  serializedEvents.push('data: [DONE]');
  return new Response(serializedEvents.join('\n\n'), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

interface ControlledStreamingResponse {
  releaseCompletion(): void;
  response: Response;
}

function createControlledStreamingResponse(): ControlledStreamingResponse {
  let resolveCompletion: (() => void) | undefined;
  const completion = new Promise<void>((resolve) => {
    resolveCompletion = resolve;
  });
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(
        `data: ${JSON.stringify({ choices: [{ delta: { content: 'first' }, index: 0 }] })}\n\n`,
      ));
      void completion.then(() => {
        controller.enqueue(encoder.encode(
          `data: ${JSON.stringify({
            choices: [],
            usage: {
              prompt_tokens_details: { cached_tokens: 100 },
              prompt_tokens: 100,
            },
          })}\n\ndata: [DONE]\n\n`,
        ));
        controller.close();
      });
    },
  });

  return {
    releaseCompletion() {
      if (resolveCompletion === undefined) throw new Error('Completion gate was not initialized');
      resolveCompletion();
    },
    response: new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    }),
  };
}

interface ProviderHarness {
  nativeFetch: ReturnType<typeof vi.fn<(url: string, requestInit?: RequestInit) => Promise<Response>>>;
  provider: ProviderFunction;
  providerOptions: ProviderOptions | undefined;
  stored: Map<string, string>;
  toastMessages: string[];
}

async function loadProvider(
  responses: Response[],
  argumentOverrides: Readonly<Record<string, string>> = {},
): Promise<ProviderHarness> {
  const stored = new Map<string, string>();
  const argumentsByKey = new Map<string, string>([
    ['api_key', 'test-key'],
    ['model', 'gpt-5.6-sol'],
    ['prompt_cache_mode', 'explicit'],
    ...Object.entries(argumentOverrides),
  ]);
  let registeredProvider: ProviderFunction | undefined;
  let providerOptions: ProviderOptions | undefined;
  const toastMessages: string[] = [];
  const nativeFetch = vi.fn(async (url: string, requestInit?: RequestInit) => {
    void url;
    void requestInit;
    const response = responses.shift();
    if (response === undefined) throw new Error('No stubbed response remains');
    return response;
  });

  vi.stubGlobal('__VERSION__', 'test');
  vi.stubGlobal('risuai', {
    getArgument: async (key: string) => argumentsByKey.get(key),
    pluginStorage: {
      getItem: async (key: string) => stored.get(key) ?? null,
      setItem: async (key: string, value: string) => {
        stored.set(key, value);
      },
    },
    nativeFetch,
    getRootDocument: async () => ({
      createElement: () => ({
        remove: async () => undefined,
        setStyleAttribute: async () => undefined,
        setTextContent: async (value: string) => {
          toastMessages.push(value);
        },
      }),
      querySelector: async () => ({ appendChild: async () => undefined }),
    }),
    addProvider: async (
      _name: string,
      provider: ProviderFunction,
      options?: ProviderOptions,
    ) => {
      registeredProvider = provider;
      providerOptions = options;
    },
    registerSetting: async () => ({ id: 'settings' }),
    onUnload: async () => undefined,
    unregisterUIPart: async () => undefined,
  });
  vi.spyOn(console, 'log').mockImplementation(() => undefined);

  await import('../plugin');
  if (registeredProvider === undefined) throw new Error('Provider was not registered');

  return { nativeFetch, provider: registeredProvider, providerOptions, stored, toastMessages };
}

function getRequestBody(
  nativeFetch: ProviderHarness['nativeFetch'],
  requestIndex: number,
): string {
  const requestInit = nativeFetch.mock.calls[requestIndex]?.[1];
  if (typeof requestInit?.body !== 'string') throw new Error('Expected a string request body');
  return requestInit.body;
}

function parseRequestBody(
  nativeFetch: ProviderHarness['nativeFetch'],
  requestIndex: number,
): Record<string, unknown> {
  const parsed: unknown = JSON.parse(getRequestBody(nativeFetch, requestIndex));
  if (!isRecord(parsed)) {
    throw new Error('Expected an object request body');
  }
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function collectTextStream(stream: ReadableStream<string>): Promise<string> {
  const reader = stream.getReader();
  let text = '';
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) return text;
      text += result.value;
    }
  } finally {
    reader.releaseLock();
  }
}

describe('provider registration metadata', () => {
  it('본체 숫자 flags, sampler parameters, o200k tokenizer를 등록한다', async () => {
    const harness = await loadProvider([], {
      flags: 'hasFirstSystemPrompt,poolSupported',
      streaming_mode: 'stream',
    });

    expect(harness.providerOptions).toEqual({
      tokenizer: 'o200k_base',
      model: {
        name: 'LLM Gateway',
        flags: [
          RISUAI_LLM_FLAGS.hasFirstSystemPrompt,
          RISUAI_LLM_FLAGS.poolSupported,
          RISUAI_LLM_FLAGS.hasStreaming,
        ],
        parameters: ['temperature', 'top_p', 'frequency_penalty', 'presence_penalty'],
      },
    });
  });

  it('미지정 기본값은 Full System Prompt 하나이고 streaming flag를 넣지 않는다', async () => {
    const harness = await loadProvider([]);

    expect(harness.providerOptions?.model?.flags).toEqual([
      RISUAI_LLM_FLAGS.hasFullSystemPrompt,
    ]);
  });
});

describe('request body options', () => {
  it('플러그인 선택값과 RisuAI penalty를 Chat Completions extra body로 전달한다', async () => {
    const harness = await loadProvider([createSuccessfulResponse()], {
      reasoning_effort: 'xhigh',
      verbosity: 'low',
    });

    await harness.provider(createProviderArguments());

    expect(parseRequestBody(harness.nativeFetch, 0)).toMatchObject({
      frequency_penalty: 0.25,
      presence_penalty: -0.5,
      reasoning_effort: 'xhigh',
      verbosity: 'low',
    });
  });

  it('미지정 reasoning_effort, verbosity, penalties는 body에서 생략한다', async () => {
    const harness = await loadProvider([createSuccessfulResponse()]);

    await harness.provider(createProviderArguments(LONG_SYSTEM_TEXT, false));

    const body = parseRequestBody(harness.nativeFetch, 0);
    expect(body).not.toHaveProperty('reasoning_effort');
    expect(body).not.toHaveProperty('verbosity');
    expect(body).not.toHaveProperty('frequency_penalty');
    expect(body).not.toHaveProperty('presence_penalty');
  });

  it('abortSignal을 nativeFetch까지 전달한다', async () => {
    const harness = await loadProvider([createSuccessfulResponse()]);
    const controller = new AbortController();

    await harness.provider(createProviderArguments(), controller.signal);

    expect(harness.nativeFetch.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
  });
});

describe('streaming modes', () => {
  it('off는 JSON generate 응답을 반환한다', async () => {
    const harness = await loadProvider([createSuccessfulResponse()]);

    const response = await harness.provider(createProviderArguments());

    expect(response).toEqual({ success: true, content: 'ok' });
    expect(parseRequestBody(harness.nativeFetch, 0)).not.toHaveProperty('stream');
  });

  it('decoupled는 streaming 연결을 끝까지 소비하고 완성 문자열과 usage를 반영한다', async () => {
    const harness = await loadProvider([createStreamingResponse()], {
      streaming_mode: 'decoupled',
    });

    const response = await harness.provider(createProviderArguments());

    expect(response).toEqual({ success: true, content: 'hello' });
    expect(parseRequestBody(harness.nativeFetch, 0)).toMatchObject({
      stream: true,
      stream_options: { include_usage: true },
    });
    expect(harness.stored.has(CACHE_ANCHOR_STATE_STORAGE_KEY)).toBe(true);
    const ledger = harness.stored.get(CACHE_LEDGER_STORAGE_KEY);
    if (ledger === undefined) throw new Error('Expected cache ledger state');
    expect(JSON.parse(ledger)).toMatchObject({
      readTokens: 1200,
      writeTokens: 200,
      costUsd: 0.01,
    });
  });

  it('stream은 text delta stream을 반환하고 완료 후 상태와 usage를 반영한다', async () => {
    const harness = await loadProvider([createStreamingResponse(['a', 'b', 'c'])], {
      streaming_mode: 'stream',
    });

    const response = await harness.provider(createProviderArguments());
    if (typeof response.content === 'string') throw new Error('Expected streaming content');

    await expect(collectTextStream(response.content)).resolves.toBe('abc');
    expect(harness.stored.has(CACHE_ANCHOR_STATE_STORAGE_KEY)).toBe(true);
    expect(harness.stored.has(CACHE_LEDGER_STORAGE_KEY)).toBe(true);
  });

  it('stream의 앵커와 원장은 upstream 완료 전에는 저장하지 않는다', async () => {
    const controlled = createControlledStreamingResponse();
    const harness = await loadProvider([controlled.response], {
      streaming_mode: 'stream',
    });

    const response = await harness.provider(createProviderArguments());
    if (typeof response.content === 'string') throw new Error('Expected streaming content');
    const reader = response.content.getReader();
    const first = await reader.read();

    expect(first).toEqual({ done: false, value: 'first' });
    expect(harness.stored.has(CACHE_ANCHOR_STATE_STORAGE_KEY)).toBe(false);
    expect(harness.stored.has(CACHE_LEDGER_STORAGE_KEY)).toBe(false);

    controlled.releaseCompletion();
    await expect(reader.read()).resolves.toEqual({ done: true, value: undefined });
    expect(harness.stored.has(CACHE_ANCHOR_STATE_STORAGE_KEY)).toBe(true);
    expect(harness.stored.has(CACHE_LEDGER_STORAGE_KEY)).toBe(true);
    reader.releaseLock();
  });

  it.each(['decoupled', 'stream'])('%s도 cache marker 400이면 원본으로 재시도한다', async (mode) => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const harness = await loadProvider([
      new Response('invalid prompt_cache breakpoint', { status: 400 }),
      createStreamingResponse(['retry-ok']),
    ], { streaming_mode: mode });

    const response = await harness.provider(createProviderArguments());
    const content = typeof response.content === 'string'
      ? response.content
      : await collectTextStream(response.content);

    expect(response.success).toBe(true);
    expect(content).toBe('retry-ok');
    expect(harness.nativeFetch).toHaveBeenCalledTimes(2);
    expect(getRequestBody(harness.nativeFetch, 0)).toContain('prompt_cache_breakpoint');
    expect(getRequestBody(harness.nativeFetch, 1)).not.toContain('prompt_cache_breakpoint');
    expect(warning).toHaveBeenCalledOnce();
  });
});

describe('cache breakpoint fallback', () => {
  it('마커 관련 400이면 원본 messages로 한 번 재시도하고 성공 뒤 앵커를 저장한다', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const harness = await loadProvider([
      new Response('invalid prompt_cache breakpoint', { status: 400 }),
      createSuccessfulResponse(),
    ]);

    const response = await harness.provider(createProviderArguments());

    expect(response).toEqual({ success: true, content: 'ok' });
    expect(harness.nativeFetch).toHaveBeenCalledTimes(2);
    expect(getRequestBody(harness.nativeFetch, 0)).toContain('prompt_cache_breakpoint');
    expect(getRequestBody(harness.nativeFetch, 1)).not.toContain('prompt_cache_breakpoint');
    expect(warning).toHaveBeenCalledOnce();
    expect(harness.stored.has(CACHE_ANCHOR_STATE_STORAGE_KEY)).toBe(true);
  });

  it('재시도도 실패하면 세 번째 요청 없이 오류를 반환한다', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const harness = await loadProvider([
      new Response('cache breakpoint rejected', { status: 400 }),
      new Response('cache breakpoint still rejected', { status: 400 }),
      createSuccessfulResponse(),
    ]);

    const response = await harness.provider(createProviderArguments());

    expect(response.success).toBe(false);
    expect(harness.nativeFetch).toHaveBeenCalledTimes(2);
    expect(harness.stored.has(CACHE_ANCHOR_STATE_STORAGE_KEY)).toBe(false);
  });

  it('마커와 무관한 400은 재시도하지 않고 실패한 diff 상태도 저장하지 않는다', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const harness = await loadProvider([
      new Response('invalid max_completion_tokens', { status: 400 }),
    ]);

    const response = await harness.provider(createProviderArguments());

    expect(response.success).toBe(false);
    expect(harness.nativeFetch).toHaveBeenCalledOnce();
    expect(warning).not.toHaveBeenCalled();
    expect(harness.stored.has(CACHE_ANCHOR_STATE_STORAGE_KEY)).toBe(false);
  });

  it('마커 관련 400이어도 1024토큰 가드로 마킹하지 않은 요청은 재시도하지 않는다', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const harness = await loadProvider([
      new Response('invalid prompt_cache breakpoint', { status: 400 }),
    ]);

    const response = await harness.provider(createProviderArguments('short system prompt'));

    expect(response.success).toBe(false);
    expect(harness.nativeFetch).toHaveBeenCalledOnce();
    expect(getRequestBody(harness.nativeFetch, 0)).not.toContain('prompt_cache_breakpoint');
    expect(warning).not.toHaveBeenCalled();
  });
});

describe('cache health backoff', () => {
  it('세 번째 연속 epoch 리셋에서 마킹을 멈추고 안정 턴에 자동 재개한다', async () => {
    vi.useFakeTimers();
    const harness = await loadProvider([
      createSuccessfulResponse(),
      createSuccessfulResponse(),
      createSuccessfulResponse(),
      createSuccessfulResponse(),
      createSuccessfulResponse(),
    ]);
    const changingSystemTexts = ['A', 'B', 'C', 'D'].map(
      (prefix) => `${prefix}${LONG_SYSTEM_TEXT}`,
    );

    for (const systemText of changingSystemTexts) {
      await harness.provider(createProviderArguments(systemText));
    }
    await harness.provider(createProviderArguments(changingSystemTexts[3]));

    expect(getRequestBody(harness.nativeFetch, 0)).toContain('prompt_cache_breakpoint');
    expect(getRequestBody(harness.nativeFetch, 1)).toContain('prompt_cache_breakpoint');
    expect(getRequestBody(harness.nativeFetch, 2)).toContain('prompt_cache_breakpoint');
    expect(getRequestBody(harness.nativeFetch, 3)).not.toContain('prompt_cache_breakpoint');
    expect(getRequestBody(harness.nativeFetch, 4)).toContain('prompt_cache_breakpoint');
    expect(harness.toastMessages).toEqual([
      'LLM Gateway: 캐시 히트 연속 3회 실패 — 캐시 마킹을 일시 중단했어요',
      'LLM Gateway: 프롬프트 앞부분이 안정되어 캐시 마킹을 다시 시작했어요',
    ]);

    const storedState = harness.stored.get(CACHE_ANCHOR_STATE_STORAGE_KEY);
    if (storedState === undefined) throw new Error('Expected cache anchor state');
    expect(JSON.parse(storedState)).toMatchObject({ consecutiveEpochResets: 0 });
  });
});
