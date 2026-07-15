import { afterEach, describe, expect, it, vi } from 'vitest';
import { CACHE_ANCHOR_STATE_STORAGE_KEY } from '../cache';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

const LONG_SYSTEM_TEXT = 'S'.repeat(6000);

function createProviderArguments(systemText = LONG_SYSTEM_TEXT): ProviderArguments {
  return {
    prompt_chat: [
      { role: 'system', content: systemText },
      { role: 'user', content: 'hello' },
    ],
    temperature: 1,
    max_tokens: 1000,
    frequency_penalty: 0,
    min_p: 0,
    presence_penalty: 0,
    repetition_penalty: 0,
    top_k: 0,
    top_p: 1,
    mode: 'chat',
  };
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

interface ProviderHarness {
  nativeFetch: ReturnType<typeof vi.fn<(url: string, requestInit?: RequestInit) => Promise<Response>>>;
  provider: ProviderFunction;
  stored: Map<string, string>;
}

async function loadProvider(responses: Response[]): Promise<ProviderHarness> {
  const stored = new Map<string, string>();
  let registeredProvider: ProviderFunction | undefined;
  const nativeFetch = vi.fn(async (url: string, requestInit?: RequestInit) => {
    void url;
    void requestInit;
    const response = responses.shift();
    if (response === undefined) throw new Error('No stubbed response remains');
    return response;
  });

  vi.stubGlobal('__VERSION__', 'test');
  vi.stubGlobal('risuai', {
    getArgument: async (key: string) => {
      if (key === 'api_key') return 'test-key';
      if (key === 'model') return 'gpt-5.6-sol';
      if (key === 'prompt_cache_mode') return 'explicit';
      return undefined;
    },
    pluginStorage: {
      getItem: async (key: string) => stored.get(key) ?? null,
      setItem: async (key: string, value: string) => {
        stored.set(key, value);
      },
    },
    nativeFetch,
    addProvider: async (_name: string, provider: ProviderFunction) => {
      registeredProvider = provider;
    },
    registerSetting: async () => ({ id: 'settings' }),
    onUnload: async () => undefined,
    unregisterUIPart: async () => undefined,
  });
  vi.spyOn(console, 'log').mockImplementation(() => undefined);

  await import('../plugin');
  if (registeredProvider === undefined) throw new Error('Provider was not registered');

  return { nativeFetch, provider: registeredProvider, stored };
}

function getRequestBody(
  nativeFetch: ProviderHarness['nativeFetch'],
  requestIndex: number,
): string {
  const requestInit = nativeFetch.mock.calls[requestIndex]?.[1];
  if (typeof requestInit?.body !== 'string') throw new Error('Expected a string request body');
  return requestInit.body;
}

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
