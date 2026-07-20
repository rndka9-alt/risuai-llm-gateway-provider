// @vitest-environment happy-dom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CACHE_ANCHOR_STATE_STORAGE_KEY } from '../cache';
import { PRESET_SCHEMES } from '../constants';
import { CACHE_LEDGER_STORAGE_KEY, accumulateCacheUsage, createEmptyCacheLedger } from '../ledger';
import {
  buildLedgerDisplay,
  formatTokenCount,
  createProviderRegistrationSignature,
  loadApiKey,
  loadConfigurableLlmFlagNames,
  loadModel,
  loadPromptCacheMode,
  loadReasoningEffort,
  loadServiceTier,
  loadStreamingMode,
  loadVerbosity,
  saveApiKey,
  saveConfigurableLlmFlagNames,
  saveServiceTier,
  saveSettings,
  openSettings,
} from '../settings';

const CONFIG_STORAGE_KEY = 'llm-gateway-provider:config';

afterEach(() => {
  render(null, document.body);
  document.body.replaceChildren();
  document.body.removeAttribute('class');
  document.head.replaceChildren();
  document.documentElement.removeAttribute('class');
  document.documentElement.removeAttribute('style');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function createPluginStorageStub(configValues: Readonly<Record<string, string>> = {}) {
  const storage = new Map<string, string>();
  if (Object.keys(configValues).length !== 0) {
    storage.set(CONFIG_STORAGE_KEY, JSON.stringify(configValues));
  }
  return {
    getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      storage.set(key, value);
    }),
    storage,
  };
}

function requireConfigStorage(pluginStorage: {
  storage: ReadonlyMap<string, unknown>;
}): Record<string, unknown> {
  const serialized = pluginStorage.storage.get(CONFIG_STORAGE_KEY);
  if (typeof serialized !== 'string') throw new Error('Expected stored config');
  const parsed: unknown = JSON.parse(serialized);
  if (!isRecord(parsed)) throw new Error('Expected config object');
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

describe('API key settings', () => {
  it('저장된 API key를 문자열 그대로 불러온다', async () => {
    const pluginStorage = createPluginStorageStub({ api_key: 'llmgtwy_secret' });
    vi.stubGlobal('risuai', { pluginStorage });

    await expect(loadApiKey()).resolves.toBe('llmgtwy_secret');
  });

  it('저장된 값이 없으면 빈 입력값을 반환한다', async () => {
    vi.stubGlobal('risuai', { pluginStorage: createPluginStorageStub() });

    await expect(loadApiKey()).resolves.toBe('');
  });

  it('API key를 config 저장소에 저장한다', async () => {
    const pluginStorage = createPluginStorageStub();
    vi.stubGlobal('risuai', { pluginStorage });

    await saveApiKey('llmgtwy_new_secret');

    expect(requireConfigStorage(pluginStorage)).toMatchObject({
      api_key: 'llmgtwy_new_secret',
      extra_body: '',
    });
  });
});

describe('prompt cache settings', () => {
  it('저장된 explicit 모드를 불러온다', async () => {
    vi.stubGlobal('risuai', {
      pluginStorage: createPluginStorageStub({ prompt_cache_mode: 'explicit' }),
    });

    await expect(loadPromptCacheMode()).resolves.toBe('explicit');
  });

  it('저장된 disabled 모드를 불러온다', async () => {
    vi.stubGlobal('risuai', {
      pluginStorage: createPluginStorageStub({ prompt_cache_mode: 'disabled' }),
    });

    await expect(loadPromptCacheMode()).resolves.toBe('disabled');
  });

  it.each([undefined, '', 'unknown'])('값이 %s이면 기본값 explicit로 불러온다', async (value) => {
    vi.stubGlobal('risuai', {
      pluginStorage: createPluginStorageStub(
        value === undefined ? {} : { prompt_cache_mode: value },
      ),
    });

    await expect(loadPromptCacheMode()).resolves.toBe('explicit');
  });

  it('전체 설정값을 함께 저장한다', async () => {
    const pluginStorage = createPluginStorageStub();
    vi.stubGlobal('risuai', { pluginStorage });

    await saveSettings({
      apiKey: 'llmgtwy_new_secret',
      extraBody: '',
      flagNames: ['hasFullSystemPrompt', 'poolSupported'],
      model: 'gpt-5.6-luna',
      promptCacheMode: 'explicit',
      reasoningEffort: 'xhigh',
      serviceTier: 'flex',
      streamingMode: 'decoupled',
      verbosity: 'low',
    });

    expect(requireConfigStorage(pluginStorage)).toEqual({
      api_key: 'llmgtwy_new_secret',
      extra_body: '',
      flags: 'hasFullSystemPrompt,poolSupported',
      model: 'gpt-5.6-luna',
      prompt_cache_mode: 'explicit',
      reasoning_effort: 'xhigh',
      service_tier: 'flex',
      streaming_mode: 'decoupled',
      verbosity: 'low',
    });
  });
});

describe('model settings', () => {
  it('저장된 모델 ID를 그대로 불러온다', async () => {
    vi.stubGlobal('risuai', {
      pluginStorage: createPluginStorageStub({ model: 'gpt-5.6-terra' }),
    });

    await expect(loadModel()).resolves.toBe('gpt-5.6-terra');
  });

  it.each([undefined, '', '  '])('값이 %s이면 기본 모델을 반환한다', async (value) => {
    vi.stubGlobal('risuai', {
      pluginStorage: createPluginStorageStub(value === undefined ? {} : { model: value }),
    });

    await expect(loadModel()).resolves.toBe('gpt-5.6-sol');
  });
});

describe('ledger display', () => {
  it('토큰 수를 k/M 단위로 축약한다', () => {
    expect(formatTokenCount(120)).toBe('120');
    expect(formatTokenCount(12_300)).toBe('12.3k');
    expect(formatTokenCount(-1_500_000)).toBe('-1.5M');
  });

  it('기록이 없으면 안내 문구를 중립 톤으로 보여준다', () => {
    expect(buildLedgerDisplay(createEmptyCacheLedger())).toEqual({
      amountText: '아직 기록 없음',
      tone: 'neutral',
    });
  });

  it('절감 USD가 없으면 토큰 등가를 이득 톤으로 보여준다', () => {
    const ledger = { ...createEmptyCacheLedger(), readTokens: 10_000, writeTokens: 4_000 };

    expect(buildLedgerDisplay(ledger)).toEqual({
      amountText: '+8.0k tokens',
      tone: 'gain',
    });
  });

  it('실측 절감액이 있으면 USD 금액을 대표값으로 쓴다', () => {
    const ledger = {
      ...createEmptyCacheLedger(),
      readTokens: 10_000,
      writeTokens: 4_000,
      costUsd: 1.2345,
      savedUsd: 0.45678,
    };

    const display = buildLedgerDisplay(ledger);
    expect(display.amountText).toBe('+$0.4568');
    expect(display.tone).toBe('gain');
  });

  it('손해면 손실 톤과 음수 금액으로 보여준다', () => {
    const ledger = { ...createEmptyCacheLedger(), writeTokens: 4_000, savedUsd: -0.5 };

    const display = buildLedgerDisplay(ledger);
    expect(display.amountText).toBe('-$0.5000');
    expect(display.tone).toBe('loss');
  });
});

describe('service tier settings', () => {
  it('저장된 flex 티어를 불러온다', async () => {
    vi.stubGlobal('risuai', {
      pluginStorage: createPluginStorageStub({ service_tier: 'flex' }),
    });

    await expect(loadServiceTier()).resolves.toBe('flex');
  });

  it.each([undefined, '', 'default', 'unknown'])(
    '값이 %s이면 Gateway 기본값을 따르도록 미지정으로 불러온다',
    async (value) => {
      vi.stubGlobal('risuai', {
        pluginStorage: createPluginStorageStub(value === undefined ? {} : { service_tier: value }),
      });

      await expect(loadServiceTier()).resolves.toBeUndefined();
    },
  );

  it('Flex 비활성화는 저장값을 비워 요청에서 생략되게 한다', async () => {
    const pluginStorage = createPluginStorageStub({ service_tier: 'flex' });
    vi.stubGlobal('risuai', { pluginStorage });

    await saveServiceTier(undefined);

    expect(requireConfigStorage(pluginStorage)).toMatchObject({ service_tier: '' });
  });

  it('Flex 활성화는 flex를 저장한다', async () => {
    const pluginStorage = createPluginStorageStub();
    vi.stubGlobal('risuai', { pluginStorage });

    await saveServiceTier('flex');

    expect(requireConfigStorage(pluginStorage)).toMatchObject({ service_tier: 'flex' });
  });
});

describe('generation option settings', () => {
  it('reasoning_effort와 verbosity 선택값을 불러온다', async () => {
    vi.stubGlobal('risuai', {
      pluginStorage: createPluginStorageStub({
        reasoning_effort: 'high',
        verbosity: 'medium',
      }),
    });

    await expect(loadReasoningEffort()).resolves.toBe('high');
    await expect(loadVerbosity()).resolves.toBe('medium');
  });

  it('미지정 선택값은 undefined로 불러온다', async () => {
    vi.stubGlobal('risuai', { pluginStorage: createPluginStorageStub() });

    await expect(loadReasoningEffort()).resolves.toBeUndefined();
    await expect(loadVerbosity()).resolves.toBeUndefined();
  });

  it('streaming_mode 기본값은 off다', async () => {
    vi.stubGlobal('risuai', { pluginStorage: createPluginStorageStub() });

    await expect(loadStreamingMode()).resolves.toBe('off');
  });

  it('기존 stream 저장값은 decoupled로 불러온다', async () => {
    vi.stubGlobal('risuai', {
      pluginStorage: createPluginStorageStub({ streaming_mode: 'stream' }),
    });

    await expect(loadStreamingMode()).resolves.toBe('decoupled');
  });

  it('flags 미지정 기본값과 저장값을 판별한다', async () => {
    const pluginStorage = createPluginStorageStub();
    vi.stubGlobal('risuai', { pluginStorage });

    await expect(loadConfigurableLlmFlagNames()).resolves.toEqual(['hasFullSystemPrompt']);
    await pluginStorage.setItem(
      CONFIG_STORAGE_KEY,
      JSON.stringify({
        flags: 'hasFirstSystemPrompt,poolSupported',
      }),
    );
    await expect(loadConfigurableLlmFlagNames()).resolves.toEqual([
      'hasFirstSystemPrompt',
      'poolSupported',
    ]);
  });

  it('모든 flags 해제 상태를 none sentinel로 저장하고 복원한다', async () => {
    const pluginStorage = createPluginStorageStub();
    vi.stubGlobal('risuai', { pluginStorage });

    await saveConfigurableLlmFlagNames([]);

    expect(requireConfigStorage(pluginStorage)).toMatchObject({ flags: 'none' });
    await expect(loadConfigurableLlmFlagNames()).resolves.toEqual([]);
  });
});

function requireInput(id: string): HTMLInputElement {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLInputElement)) {
    throw new Error(`Expected #${id} to be an input`);
  }
  return element;
}

function requireSelect(id: string): HTMLSelectElement {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLSelectElement)) {
    throw new Error(`Expected #${id} to be a select`);
  }
  return element;
}

function requireRange(id: string): HTMLInputElement {
  const element = requireInput(id);
  if (element.type !== 'range') {
    throw new Error(`Expected #${id} to be a range input`);
  }
  return element;
}

function requireButton(id: string): HTMLButtonElement {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLButtonElement)) {
    throw new Error(`Expected #${id} to be a button`);
  }
  return element;
}

async function dispatchChange(element: HTMLInputElement | HTMLSelectElement): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();
  });
}

async function dispatchInput(element: HTMLInputElement): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await Promise.resolve();
  });
}

async function dispatchBlur(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.focus();
    element.blur();
    await Promise.resolve();
  });
}

async function expandSettingsAccordion(id: string): Promise<void> {
  const toggle = requireButton(`${id}-toggle`);
  if (toggle.getAttribute('aria-expanded') === 'true') return;
  await act(async () => toggle.click());
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
}

function stubSettingsUi(
  configValues: Readonly<Record<string, string>> = {},
  storageValues: Readonly<Record<string, unknown>> = {},
) {
  const storage = new Map(Object.entries(storageValues));
  if (Object.keys(configValues).length !== 0) {
    storage.set(CONFIG_STORAGE_KEY, JSON.stringify(configValues));
  }
  const setItem = vi.fn(async (key: string, value: unknown) => {
    storage.set(key, value);
  });
  const showContainer = vi.fn().mockResolvedValue(undefined);
  const hideContainer = vi.fn().mockResolvedValue(undefined);

  vi.stubGlobal('risuai', {
    showContainer,
    hideContainer,
    getColorScheme: vi.fn().mockResolvedValue({
      name: 'light',
      scheme: PRESET_SCHEMES['light'],
    }),
    pluginStorage: {
      getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
      setItem,
    },
  });

  return { hideContainer, setItem, showContainer, storage };
}

async function renderSettingsUi(
  configValues: Readonly<Record<string, string>> = {},
  storageValues: Readonly<Record<string, unknown>> = {},
): Promise<ReturnType<typeof stubSettingsUi>> {
  const harness = stubSettingsUi(configValues, storageValues);
  await act(async () => {
    await openSettings({ flagNames: ['hasFullSystemPrompt'] });
  });
  return harness;
}

describe('settings UI', () => {
  it('저장된 인자와 flag 상태를 Preact DOM에 반영한다', async () => {
    const harness = await renderSettingsUi({
      api_key: 'llmgtwy_secret',
      flags: 'hasFirstSystemPrompt,poolSupported',
      model: 'gpt-5.6-custom',
      prompt_cache_mode: 'disabled',
      reasoning_effort: 'high',
      service_tier: 'flex',
      streaming_mode: 'decoupled',
      verbosity: 'medium',
    });

    expect(harness.showContainer).toHaveBeenCalledWith('fullscreen');
    expect(requireInput('api-key').disabled).toBe(true);
    expect(requireInput('api-key').value).toBe('llmgtwy_secret');
    expect(requireInput('api-key').type).toBe('password');
    expect(requireButton('api-key-edit').disabled).toBe(false);
    expect(document.getElementById('status-streaming-chip')?.textContent).toBe('실시간');
    expect(document.getElementById('status-flex-chip')?.textContent).toBe('flex');
    expect(document.getElementById('status-model')?.textContent).toBe('gpt-5.6-custom');
    expect(requireSelect('prompt-cache-mode').value).toBe('disabled');
    expect(requireRange('reasoning-effort').value).toBe('4');
    expect(requireRange('reasoning-effort').getAttribute('aria-valuetext')).toBe('high');
    expect(requireRange('reasoning-effort').dataset.unset).toBe('false');
    expect(requireRange('verbosity').value).toBe('2');
    expect(requireRange('verbosity').getAttribute('aria-valuetext')).toBe('medium');

    await expandSettingsAccordion('advanced-settings');
    expect(requireSelect('model').value).toBe('gpt-5.6-custom');
    expect(requireInput('streaming-mode').checked).toBe(true);
    expect(requireInput('service-tier').checked).toBe(true);
    expect(requireInput('flag-hasFullSystemPrompt').checked).toBe(false);
    expect(requireInput('flag-hasFirstSystemPrompt').checked).toBe(true);
    expect(requireInput('flag-poolSupported').checked).toBe(true);

    expect(requireInput('flag-hasImageInput').checked).toBe(false);
    expect(requireInput('flag-hasImageInput').disabled).toBe(false);
    expect(document.querySelector('fieldset label:last-child')?.textContent).toBe('Image Input');
    expect(document.body.textContent).not.toContain('Image Input · 미지원');
    expect(document.body.textContent).not.toContain('Image Output');
  });

  it('API key 표시 토글을 DOM 상태와 접근성 속성에 반영한다', async () => {
    await renderSettingsUi({ api_key: 'llmgtwy_secret' });
    const input = requireInput('api-key');
    const button = requireButton('api-key-visibility');

    await act(async () => requireButton('api-key-edit').click());
    await act(async () => button.click());
    expect(input.disabled).toBe(false);
    expect(input.type).toBe('text');
    expect(button.getAttribute('aria-label')).toBe('API 키 숨기기');
    expect(button.getAttribute('aria-pressed')).toBe('true');
  });

  it('API key를 blur에서 저장하고 상태바 전환 순서와 활성 칩을 유지한다', async () => {
    const harness = await renderSettingsUi({
      model: 'gpt-5.6-terra',
      service_tier: 'flex',
      streaming_mode: 'decoupled',
    });
    const app = document.getElementById('app');
    const editor = document.getElementById('api-key-editor');
    const summary = document.getElementById('settings-status-summary');
    if (app === null || editor === null || summary === null) {
      throw new Error('Expected settings status bar elements');
    }

    expect(app.className).toContain('min-h-[420px]');
    expect(app.className).toContain('max-h-[min(720px,calc(100vh-40px))]');
    expect(editor.className).toContain('w-full');
    expect(editor.className).toContain('duration-150');
    expect(summary.className).toContain('opacity-0');
    expect(summary.className).toContain('delay-0');
    expect(document.getElementById('status-streaming-chip')?.textContent).toBe('실시간');
    expect(document.getElementById('status-flex-chip')?.textContent).toBe('flex');
    expect(document.getElementById('status-model')?.textContent).toBe('Terra');

    const input = requireInput('api-key');
    input.value = 'llmgtwy_blurred';
    await dispatchInput(input);
    expect(requireConfigStorage(harness)).not.toHaveProperty('api_key');

    await dispatchBlur(input);
    expect(requireConfigStorage(harness)).toMatchObject({ api_key: 'llmgtwy_blurred' });
    expect(input.disabled).toBe(true);
    expect(editor.className).toContain('w-0');
    expect(editor.className).toContain('opacity-0');
    expect(summary.className).toContain('opacity-100');
    expect(summary.className).toContain('delay-100');
    expect(summary.className).toContain('duration-200');

    await act(async () => requireButton('api-key-edit').click());
    expect(input.disabled).toBe(false);
    expect(editor.className).toContain('w-full');
    expect(summary.className).toContain('opacity-0');
    expect(summary.className).toContain('delay-0');
  });

  it('아코디언은 기본 접힘이고 상태 점·전환·재오픈 상태를 유지한다', async () => {
    await renderSettingsUi({ extra_body: '{"temperature": 1}' });
    const requestBodyToggle = requireButton('request-body-settings-toggle');
    const advancedToggle = requireButton('advanced-settings-toggle');
    const requestBodyContent = document.getElementById('request-body-settings-content');
    if (requestBodyContent === null) throw new Error('Expected request body accordion content');

    expect(requestBodyToggle.getAttribute('aria-expanded')).toBe('false');
    expect(advancedToggle.getAttribute('aria-expanded')).toBe('false');
    expect(requestBodyContent.getAttribute('aria-hidden')).toBe('true');
    expect(requestBodyContent.className).toContain('grid-rows-[0fr]');
    expect(requestBodyContent.className).toContain('duration-150');
    expect(requestBodyContent.className).toContain('motion-reduce:transition-none');
    expect(document.getElementById('request-body-settings-indicator')?.className).toContain(
      'bg-ui-gain',
    );

    await expandSettingsAccordion('request-body-settings');
    await expandSettingsAccordion('advanced-settings');
    expect(requestBodyContent.className).toContain('grid-rows-[1fr]');
    expect(requestBodyContent.className).toContain('opacity-100');

    await act(async () => requireButton('close').click());
    await act(async () => {
      await openSettings({ flagNames: ['hasFullSystemPrompt'] });
    });
    expect(requireButton('request-body-settings-toggle').getAttribute('aria-expanded')).toBe(
      'true',
    );
    expect(requireButton('advanced-settings-toggle').getAttribute('aria-expanded')).toBe('true');
  });

  it('비활성 상태 칩은 숨기고 모델명은 항상 짧은 라벨로 표시한다', async () => {
    await renderSettingsUi({ api_key: 'llmgtwy_secret', model: 'gpt-5.6-luna' });

    expect(document.getElementById('status-streaming-chip')).toBeNull();
    expect(document.getElementById('status-flex-chip')).toBeNull();
    expect(document.getElementById('status-model')?.textContent).toBe('Luna');
    // 축약 라벨이어도 전체 모델 ID는 title로 확인할 수 있어야 한다
    expect(document.getElementById('status-model')?.getAttribute('title')).toBe('gpt-5.6-luna');
  });

  it('커스텀 body 상태 점은 에러·워닝·빈 객체를 구분한다', async () => {
    await renderSettingsUi({ extra_body: '{ "stream": tru' });
    expect(document.getElementById('request-body-settings-indicator')?.className).toContain(
      'bg-ui-loss',
    );

    await renderSettingsUi({ extra_body: '{ "stream": true }' });
    expect(document.getElementById('request-body-settings-indicator')?.className).toContain(
      'bg-ui-warn',
    );

    await renderSettingsUi({ extra_body: '{}' });
    expect(document.getElementById('request-body-settings-indicator')).toBeNull();
  });

  it('지정 안 함을 slider 첫 단계의 muted 상태로 표시한다', async () => {
    await renderSettingsUi();
    const reasoningEffort = requireRange('reasoning-effort');
    const verbosity = requireRange('verbosity');

    expect(reasoningEffort.value).toBe('0');
    expect(reasoningEffort.max).toBe('6');
    expect(reasoningEffort.dataset.unset).toBe('true');
    expect(reasoningEffort.getAttribute('aria-valuetext')).toBe('지정 안 함');
    expect(document.getElementById('reasoning-effort-value')?.textContent).toBe('지정 안 함');
    expect(verbosity.value).toBe('0');
    expect(verbosity.max).toBe('3');
    expect(verbosity.dataset.unset).toBe('true');
  });

  it('드래그 입력 중 reasoning의 표시와 저장값을 즉시 갱신한다', async () => {
    const harness = await renderSettingsUi();
    const reasoningEffort = requireRange('reasoning-effort');

    reasoningEffort.value = '5';
    await dispatchInput(reasoningEffort);
    expect(document.getElementById('reasoning-effort-value')?.textContent).toBe('xhigh');
    expect(reasoningEffort.getAttribute('aria-valuetext')).toBe('xhigh');
    expect(requireConfigStorage(harness)).toMatchObject({ reasoning_effort: 'xhigh' });

    reasoningEffort.value = '0';
    await dispatchInput(reasoningEffort);
    expect(document.getElementById('reasoning-effort-value')?.textContent).toBe('지정 안 함');
    expect(requireConfigStorage(harness)).toMatchObject({ reasoning_effort: '' });
  });

  it('폼 변경은 즉시, API key는 blur에서 config JSON으로 저장한다', async () => {
    const harness = await renderSettingsUi();

    const apiKey = requireInput('api-key');
    apiKey.value = 'llmgtwy_changed';
    await dispatchInput(apiKey);
    await dispatchBlur(apiKey);

    await expandSettingsAccordion('advanced-settings');

    const model = requireSelect('model');
    model.value = 'gpt-5.6-luna';
    await dispatchChange(model);

    const cacheMode = requireSelect('prompt-cache-mode');
    cacheMode.value = 'disabled';
    await dispatchChange(cacheMode);

    const reasoningEffort = requireRange('reasoning-effort');
    reasoningEffort.value = '5';
    await dispatchInput(reasoningEffort);

    const verbosity = requireRange('verbosity');
    verbosity.value = '1';
    await dispatchInput(verbosity);

    const streamingMode = requireInput('streaming-mode');
    streamingMode.checked = true;
    await dispatchChange(streamingMode);

    const serviceTier = requireInput('service-tier');
    serviceTier.checked = true;
    await dispatchChange(serviceTier);

    const poolSupported = requireInput('flag-poolSupported');
    poolSupported.checked = true;
    await dispatchChange(poolSupported);

    const imageInput = requireInput('flag-hasImageInput');
    imageInput.checked = true;
    await dispatchChange(imageInput);

    const storedConfig = harness.storage.get(CONFIG_STORAGE_KEY);
    expect(typeof storedConfig).toBe('string');
    if (typeof storedConfig !== 'string') throw new Error('Expected serialized config');
    expect(JSON.parse(storedConfig)).toEqual({
      api_key: 'llmgtwy_changed',
      extra_body: '',
      flags: 'hasFullSystemPrompt,poolSupported,hasImageInput',
      model: 'gpt-5.6-luna',
      prompt_cache_mode: 'disabled',
      reasoning_effort: 'xhigh',
      service_tier: 'flex',
      streaming_mode: 'decoupled',
      verbosity: 'low',
    });
    expect(document.getElementById('reload-notice')?.textContent).toContain(
      '적용하려면 새로고침이 필요합니다.',
    );

    poolSupported.checked = false;
    await dispatchChange(poolSupported);
    imageInput.checked = false;
    await dispatchChange(imageInput);
    expect(document.getElementById('reload-notice')).toBeNull();
  });

  it('flags 변경 후 설정창을 재오픈해도 새로고침 안내를 복원한다', async () => {
    await renderSettingsUi();
    await expandSettingsAccordion('advanced-settings');

    const poolSupported = requireInput('flag-poolSupported');
    poolSupported.checked = true;
    await dispatchChange(poolSupported);
    expect(document.getElementById('reload-notice')?.textContent).toContain(
      '적용하려면 새로고침이 필요합니다.',
    );

    await act(async () => requireButton('close').click());
    await act(async () => {
      await openSettings({ flagNames: ['hasFullSystemPrompt'] });
    });

    expect(document.getElementById('reload-notice')?.textContent).toContain(
      '적용하려면 새로고침이 필요합니다.',
    );
  });

  it('손익·백오프를 표시하고 원장 초기화를 저장소에 반영한다', async () => {
    const ledger = {
      ...createEmptyCacheLedger(),
      readTokens: 10_000,
      writeTokens: 4_000,
    };
    const anchorState = {
      anchorIndexes: [],
      consecutiveEpochResets: 3,
      fingerprints: [],
    };
    const harness = await renderSettingsUi(
      {},
      {
        [CACHE_ANCHOR_STATE_STORAGE_KEY]: JSON.stringify(anchorState),
        [CACHE_LEDGER_STORAGE_KEY]: JSON.stringify(ledger),
      },
    );

    expect(document.getElementById('ledger-amount-summary')?.textContent).toBe('+8.0k tokens');
    expect(document.getElementById('ledger-read-detail')?.textContent).toBe('10.0k');
    expect(document.getElementById('ledger-write-detail')?.textContent).toBe('4.0k');
    expect(document.getElementById('cache-backoff-diagnostic')?.textContent).toContain(
      '{{time}}/{{random}}/확률 로어북',
    );

    await act(async () => {
      requireButton('ledger-reset').click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(harness.setItem).toHaveBeenCalledWith(CACHE_LEDGER_STORAGE_KEY, expect.any(String));
    const storedLedger = harness.storage.get(CACHE_LEDGER_STORAGE_KEY);
    expect(typeof storedLedger).toBe('string');
    if (typeof storedLedger !== 'string') {
      throw new Error('Expected serialized cache ledger');
    }
    expect(JSON.parse(storedLedger)).toMatchObject({ readTokens: 0, writeTokens: 0 });
    expect(document.getElementById('ledger-amount-summary')?.textContent).toBe('아직 기록 없음');
  });

  it('요청부가 원장을 갱신하면 숨겨진 설정 화면과 재오픈 표시에 반영한다', async () => {
    const initialLedger = {
      ...createEmptyCacheLedger(),
      readTokens: 1_000,
      writeTokens: 400,
    };
    const harness = await renderSettingsUi(
      {},
      { [CACHE_LEDGER_STORAGE_KEY]: JSON.stringify(initialLedger) },
    );

    expect(document.getElementById('ledger-read-detail')?.textContent).toBe('1.0k');

    await act(async () => requireButton('close').click());
    expect(harness.hideContainer).toHaveBeenCalledOnce();

    await act(async () => {
      await accumulateCacheUsage(
        { cacheReadInputTokens: 9_000, cacheCreationInputTokens: 3_600 },
        {},
        'gpt-5.6-sol',
      );
    });

    expect(document.getElementById('ledger-read-detail')?.textContent).toBe('10.0k');
    expect(document.getElementById('ledger-write-detail')?.textContent).toBe('4.0k');
    expect(document.getElementById('ledger-amount-summary')?.textContent).toBe('+8.0k tokens');

    await act(async () => {
      await openSettings({ flagNames: ['hasFullSystemPrompt'] });
    });

    expect(document.getElementById('ledger-read-detail')?.textContent).toBe('10.0k');
    expect(document.getElementById('ledger-write-detail')?.textContent).toBe('4.0k');
    expect(document.getElementById('ledger-amount-summary')?.textContent).toBe('+8.0k tokens');
  });

  it('Tailwind 유틸리티와 호버·포커스 팝오버, sticky footer를 와이어한다', async () => {
    await renderSettingsUi();
    await expandSettingsAccordion('advanced-settings');

    expect(document.getElementById('llm-gateway-styles')).not.toBeNull();
    expect(document.body.classList.contains('bg-black/55')).toBe(true);
    expect(requireRange('reasoning-effort').classList.contains('stepped-slider')).toBe(true);
    expect(document.getElementById('reasoning-effort-track')?.className).toContain('inset-x-0');
    expect(document.getElementById('reasoning-effort-thumb')?.className).toContain(
      'stepped-slider-thumb',
    );
    expect(document.getElementById('streaming-mode-tooltip')?.className).toContain(
      'group-focus-within:visible',
    );
    expect(document.getElementById('prompt-cache-mode-tooltip')?.className).toContain(
      'group-focus-within:visible',
    );
    expect(document.getElementById('ledger-popover')?.className).toContain('group-hover:visible');
    expect(document.querySelector('footer')?.classList.contains('sticky')).toBe(true);
    expect(document.querySelector('button[type="submit"]')).toBeNull();
  });

  it('도움말·닫기 동작과 저장 실패 표시를 유지한다', async () => {
    const harness = await renderSettingsUi();
    await expandSettingsAccordion('advanced-settings');
    expect(document.getElementById('prompt-cache-mode-tooltip')?.textContent).toContain(
      '추가 캐시 쓰기 비용이 발생하지 않습니다.',
    );
    expect(document.getElementById('streaming-mode-tooltip')?.textContent).toContain(
      '플러그인이 모두 조립한 뒤 RisuAI에 한 번에 전달합니다.',
    );
    expect(document.getElementById('service-tier-tooltip')?.textContent).toContain(
      '입력·출력 비용이 절반으로 줄어듭니다.',
    );

    await act(async () => requireButton('close').click());
    expect(harness.hideContainer).toHaveBeenCalledOnce();

    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    harness.setItem.mockRejectedValueOnce(new Error('storage unavailable'));
    const apiKey = requireInput('api-key');
    apiKey.value = 'will-fail';
    await dispatchInput(apiKey);
    await dispatchBlur(apiKey);
    await act(async () => Promise.resolve());
    expect(document.getElementById('save-error')?.textContent).toContain('저장에 실패');

    await act(async () => requireButton('api-key-edit').click());
    apiKey.value = 'will-succeed';
    await dispatchInput(apiKey);
    await dispatchBlur(apiKey);
    await act(async () => Promise.resolve());
    expect(document.getElementById('save-error')).toBeNull();
  });

  it('재등록 대상인 flags 순서와 무관하게 동일한 설정으로 판별한다', () => {
    expect(
      createProviderRegistrationSignature({
        flagNames: ['poolSupported', 'hasFullSystemPrompt'],
      }),
    ).toBe(
      createProviderRegistrationSignature({
        flagNames: ['hasFullSystemPrompt', 'poolSupported'],
      }),
    );
  });
});
