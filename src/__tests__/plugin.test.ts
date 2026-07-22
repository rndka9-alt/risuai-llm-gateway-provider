import { afterEach, describe, expect, it, vi } from 'vitest';
import { CACHE_ANCHOR_STATE_STORAGE_KEY } from '../cache/constants';
import { CACHE_LEDGER_STORAGE_KEY } from '../ledger';
import { RISUAI_LLM_FLAGS, RISUAI_TIKTOKEN_O200_BASE_TOKENIZER } from '../options';

const CONFIG_STORAGE_KEY = 'llm-gateway-provider:config';

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

function createStreamingResponse(textDeltas: readonly string[] = ['hel', 'lo']): Response {
  const serializedEvents = textDeltas.map(
    (text) =>
      `data: ${JSON.stringify({
        choices: [{ delta: { content: text }, index: 0 }],
      })}`,
  );
  serializedEvents.push(
    `data: ${JSON.stringify({
      choices: [{ delta: {}, finish_reason: 'stop', index: 0 }],
    })}`,
  );
  serializedEvents.push(
    `data: ${JSON.stringify({
      choices: [],
      usage: {
        completion_tokens: 2,
        cost: 0.01,
        prompt_tokens: 1500,
        prompt_tokens_details: { cache_write_tokens: 200, cached_tokens: 1200 },
        total_tokens: 1502,
      },
    })}`,
  );
  serializedEvents.push('data: [DONE]');
  return new Response(serializedEvents.join('\n\n'), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

function createAbortingStreamingResponse(abortController: AbortController): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ choices: [{ delta: { content: 'first' }, index: 0 }] })}\n\n`,
          ),
        );
        abortController.abort();
        controller.close();
      },
    },
    { highWaterMark: 0 },
  );

  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

interface ProviderHarness {
  nativeFetch: ReturnType<
    typeof vi.fn<(url: string, requestInit?: RequestInit) => Promise<Response>>
  >;
  provider: ProviderFunction;
  providerOptions: ProviderOptions | undefined;
  startupEvents: string[];
  stored: Map<string, string>;
  toastMessages: string[];
}

async function loadProvider(
  responses: Response[],
  argumentOverrides: Readonly<Record<string, string>> = {},
  failConfigStorage = false,
  initialConfigFlags: string | undefined = undefined,
  cacheAnchorBankLoadFailures = 0,
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
  const startupEvents: string[] = [];
  let resolveStartup: (() => void) | undefined;
  const startupCompleted = new Promise<void>((resolve) => {
    resolveStartup = resolve;
  });
  const toastMessages: string[] = [];
  let remainingCacheAnchorBankLoadFailures = cacheAnchorBankLoadFailures;
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
      getItem: async (key: string) => {
        startupEvents.push(`getItem:${key}`);
        if (failConfigStorage) {
          throw new Error('config storage unavailable');
        }
        if (key === CACHE_ANCHOR_STATE_STORAGE_KEY && remainingCacheAnchorBankLoadFailures > 0) {
          remainingCacheAnchorBankLoadFailures -= 1;
          throw new Error('cache anchor bank storage unavailable');
        }
        return stored.get(key) ?? null;
      },
      setItem: async (key: string, value: string) => {
        startupEvents.push(`setItem:${key}`);
        stored.set(key, value);
      },
    },
    nativeFetch,
    getRootDocument: async () => ({
      createElement: async () => ({
        remove: async () => undefined,
        setStyleAttribute: async () => undefined,
        setTextContent: async (value: string) => {
          toastMessages.push(value);
        },
      }),
      querySelector: async () => ({ appendChild: async () => undefined }),
    }),
    addProvider: async (_name: string, provider: ProviderFunction, options?: ProviderOptions) => {
      startupEvents.push('addProvider');
      registeredProvider = provider;
      providerOptions = options;
    },
    registerSetting: async () => ({ id: 'settings' }),
    onUnload: async () => {
      if (resolveStartup === undefined) {
        throw new Error('Startup completion resolver was not initialized');
      }
      resolveStartup();
    },
    unregisterUIPart: async () => undefined,
  });
  vi.spyOn(console, 'log').mockImplementation(() => undefined);

  if (initialConfigFlags !== undefined) {
    const { saveConfig } = await import('../config');
    await saveConfig({ flags: initialConfigFlags });
    startupEvents.length = 0;
  }
  await import('../plugin');
  await startupCompleted;
  if (registeredProvider === undefined) throw new Error('Provider was not registered');

  return {
    nativeFetch,
    provider: registeredProvider,
    providerOptions,
    startupEvents,
    stored,
    toastMessages,
  };
}

function getRequestBody(nativeFetch: ProviderHarness['nativeFetch'], requestIndex: number): string {
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

describe('provider registration metadata', () => {
  it('provider 등록 전에 cache anchor bank snapshot eager load를 시작한다', async () => {
    const harness = await loadProvider([]);

    expect(harness.startupEvents.indexOf(`getItem:${CACHE_ANCHOR_STATE_STORAGE_KEY}`)).toBeLessThan(
      harness.startupEvents.indexOf('addProvider'),
    );
  });

  it('cache anchor bank eager load 실패를 무시하고 요청 시 lazy load로 재시도한다', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const harness = await loadProvider([createSuccessfulResponse()], {}, false, undefined, 1);

    const response = await harness.provider(createProviderArguments());

    expect(response.success).toBe(true);
    expect(
      harness.startupEvents.filter(
        (event) => event === `getItem:${CACHE_ANCHOR_STATE_STORAGE_KEY}`,
      ),
    ).toHaveLength(2);
    expect(consoleError).toHaveBeenCalledWith(
      '[llm-gateway-provider] cache anchor bank eager load failed; continuing',
      expect.any(Error),
    );
  });

  it('저장 config flags를 realArg보다 우선해 provider 등록에 반영한다', async () => {
    const harness = await loadProvider(
      [],
      { flags: 'hasFullSystemPrompt' },
      false,
      'hasFirstSystemPrompt,poolSupported',
    );

    expect(harness.providerOptions?.model?.flags).toEqual([
      RISUAI_LLM_FLAGS.hasFirstSystemPrompt,
      RISUAI_LLM_FLAGS.poolSupported,
    ]);
    expect(harness.startupEvents.indexOf(`getItem:${CONFIG_STORAGE_KEY}`)).toBeLessThan(
      harness.startupEvents.indexOf('addProvider'),
    );
  });

  it('config 저장소 실패가 provider 등록을 막지 않는다', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const harness = await loadProvider([], {}, true);

    expect(harness.providerOptions?.model?.flags).toEqual([RISUAI_LLM_FLAGS.hasFullSystemPrompt]);
    expect(harness.startupEvents).toContain('addProvider');
    expect(consoleError).toHaveBeenCalledWith(
      '[llm-gateway-provider] config startup initialization failed; continuing with defaults',
      expect.any(Error),
    );
  });

  it('본체 숫자 flags, sampler parameters, V3와 legacy o200k tokenizer를 등록한다', async () => {
    const harness = await loadProvider([], {
      flags: 'hasFirstSystemPrompt,poolSupported',
      streaming_mode: 'decoupled',
    });

    expect(harness.providerOptions).toEqual({
      tokenizer: 'o200k_base',
      model: {
        name: 'LLM Gateway',
        flags: [RISUAI_LLM_FLAGS.hasFirstSystemPrompt, RISUAI_LLM_FLAGS.poolSupported],
        parameters: ['temperature', 'top_p', 'frequency_penalty', 'presence_penalty'],
        tokenizer: RISUAI_TIKTOKEN_O200_BASE_TOKENIZER,
      },
    });
  });

  it('미지정 기본값은 Full System Prompt 하나이고 streaming flag를 넣지 않는다', async () => {
    const harness = await loadProvider([]);

    expect(harness.providerOptions?.model?.flags).toEqual([RISUAI_LLM_FLAGS.hasFullSystemPrompt]);
  });

  it('none sentinel이면 이미지 입력을 포함한 모든 flag를 해제한다', async () => {
    const harness = await loadProvider([], { flags: 'none' });

    expect(harness.providerOptions?.model?.flags).toEqual([]);
  });

  it('이미지 입력을 선택한 경우에만 해당 flag를 등록한다', async () => {
    const harness = await loadProvider([], { flags: 'hasFullSystemPrompt,hasImageInput' });

    expect(harness.providerOptions?.model?.flags).toEqual([
      RISUAI_LLM_FLAGS.hasFullSystemPrompt,
      RISUAI_LLM_FLAGS.hasImageInput,
    ]);
  });
});

describe('request body options', () => {
  it('API 키가 없으면 사용자가 바로 해결할 수 있는 안내를 반환한다', async () => {
    const harness = await loadProvider([], { api_key: '' });

    const response = await harness.provider(createProviderArguments());

    expect(response).toEqual({
      success: false,
      content:
        'LLM Gateway API 키가 설정되어 있지 않아요.\n플러그인 설정에서 API 키를 입력해 주세요.',
    });
    expect(harness.nativeFetch).not.toHaveBeenCalled();
  });

  it('model 인자가 비어 있으면 UI 표시값과 같은 기본 모델로 요청한다', async () => {
    const harness = await loadProvider([createSuccessfulResponse()], { model: '' });

    await harness.provider(createProviderArguments());

    expect(parseRequestBody(harness.nativeFetch, 0).model).toBe('gpt-5.6-sol');
  });

  it('image-only 안정 prefix를 cache breakpoint가 있는 image_url로 전달한다', async () => {
    const harness = await loadProvider([createSuccessfulResponse()]);
    const providerArguments = createProviderArguments();

    await harness.provider({
      ...providerArguments,
      prompt_chat: [
        {
          role: 'user',
          content: '',
          multimodals: [
            {
              type: 'image',
              base64: 'data:image/png;base64,abc',
              width: 1024,
              height: 1024,
            },
          ],
        },
        { role: 'assistant', content: 'reply' },
        { role: 'user', content: 'next' },
      ],
    });

    expect(parseRequestBody(harness.nativeFetch, 0).messages).toEqual([
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: 'data:image/png;base64,abc' },
            prompt_cache_breakpoint: { mode: 'explicit' },
          },
        ],
      },
      { role: 'assistant', content: 'reply' },
      { role: 'user', content: 'next' },
    ]);
  });

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

  it('Flex 서비스 티어를 명시적으로 전달한다', async () => {
    const harness = await loadProvider([createSuccessfulResponse()], {
      service_tier: 'flex',
    });

    await harness.provider(createProviderArguments());

    expect(parseRequestBody(harness.nativeFetch, 0)).toMatchObject({
      service_tier: 'flex',
    });
  });

  it('구버전 default 서비스 티어는 Gateway 기본값을 따르도록 생략한다', async () => {
    const harness = await loadProvider([createSuccessfulResponse()], {
      service_tier: 'default',
    });

    await harness.provider(createProviderArguments());

    expect(parseRequestBody(harness.nativeFetch, 0)).not.toHaveProperty('service_tier');
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
      service_tier: 'flex',
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
      lastCostSample: { requestedServiceTier: 'flex' },
    });
  });

  it('기존 stream 저장값도 decoupled 완성 문자열로 반환한다', async () => {
    const harness = await loadProvider([createStreamingResponse(['legacy'])], {
      streaming_mode: 'stream',
    });

    const response = await harness.provider(createProviderArguments());

    expect(response).toEqual({ success: true, content: 'legacy' });
  });

  it('decoupled 소비 중 abort되면 실패하고 앵커와 원장을 저장하지 않는다', async () => {
    const abortController = new AbortController();
    const harness = await loadProvider([createAbortingStreamingResponse(abortController)], {
      streaming_mode: 'decoupled',
    });

    const response = await harness.provider(createProviderArguments(), abortController.signal);

    expect(response.success).toBe(false);
    expect(harness.nativeFetch).toHaveBeenCalledOnce();
    expect(harness.stored.has(CACHE_ANCHOR_STATE_STORAGE_KEY)).toBe(false);
    expect(harness.stored.has(CACHE_LEDGER_STORAGE_KEY)).toBe(false);
  });
});

describe('cache health backoff', () => {
  it('세 번째 연속 bank miss에서 마킹을 멈추고 안정 턴에 자동 재개한다', async () => {
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
    expect(getRequestBody(harness.nativeFetch, 2)).not.toContain('prompt_cache_breakpoint');
    expect(getRequestBody(harness.nativeFetch, 3)).not.toContain('prompt_cache_breakpoint');
    expect(getRequestBody(harness.nativeFetch, 4)).toContain('prompt_cache_breakpoint');
    expect(harness.toastMessages).toEqual([
      'LLM Gateway: 캐시 히트 연속 3회 실패 — 캐시 마킹을 일시 중단했어요',
      'LLM Gateway: 프롬프트 앞부분이 안정되어 캐시 마킹을 다시 시작했어요',
    ]);

    const storedState = harness.stored.get(CACHE_ANCHOR_STATE_STORAGE_KEY);
    if (storedState === undefined) throw new Error('Expected cache anchor state');
    expect(JSON.parse(storedState)).toMatchObject({ consecutiveBankMisses: 0 });
  });
});
