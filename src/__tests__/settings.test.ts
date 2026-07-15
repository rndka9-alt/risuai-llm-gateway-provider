import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  loadApiKey,
  loadModel,
  loadPromptCacheMode,
  loadServiceTier,
  saveApiKey,
  saveSettings,
} from '../settings';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('API key settings', () => {
  it('저장된 API key를 문자열 그대로 불러온다', async () => {
    const getArgument = vi.fn().mockResolvedValue('llmgtwy_secret');
    vi.stubGlobal('risuai', { getArgument });

    await expect(loadApiKey()).resolves.toBe('llmgtwy_secret');
    expect(getArgument).toHaveBeenCalledWith('api_key');
  });

  it('저장된 값이 없으면 빈 입력값을 반환한다', async () => {
    vi.stubGlobal('risuai', { getArgument: vi.fn().mockResolvedValue(undefined) });

    await expect(loadApiKey()).resolves.toBe('');
  });

  it('API key를 플러그인 인자에 저장한다', async () => {
    const setArgument = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('risuai', { setArgument });

    await saveApiKey('llmgtwy_new_secret');

    expect(setArgument).toHaveBeenCalledWith('api_key', 'llmgtwy_new_secret');
  });
});

describe('prompt cache settings', () => {
  it('저장된 explicit 모드를 불러온다', async () => {
    const getArgument = vi.fn().mockResolvedValue('explicit');
    vi.stubGlobal('risuai', { getArgument });

    await expect(loadPromptCacheMode()).resolves.toBe('explicit');
    expect(getArgument).toHaveBeenCalledWith('prompt_cache_mode');
  });

  it.each([undefined, '', 'unknown'])('값이 %s이면 disabled로 불러온다', async (value) => {
    vi.stubGlobal('risuai', { getArgument: vi.fn().mockResolvedValue(value) });

    await expect(loadPromptCacheMode()).resolves.toBe('disabled');
  });

  it('API key·모델·캐시 모드·서비스 티어를 함께 저장한다', async () => {
    const setArgument = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('risuai', { setArgument });

    await saveSettings({
      apiKey: 'llmgtwy_new_secret',
      model: 'gpt-5.6-luna',
      promptCacheMode: 'explicit',
      serviceTier: 'flex',
    });

    expect(setArgument).toHaveBeenCalledWith('api_key', 'llmgtwy_new_secret');
    expect(setArgument).toHaveBeenCalledWith('model', 'gpt-5.6-luna');
    expect(setArgument).toHaveBeenCalledWith('prompt_cache_mode', 'explicit');
    expect(setArgument).toHaveBeenCalledWith('service_tier', 'flex');
  });
});

describe('model settings', () => {
  it('저장된 모델 ID를 그대로 불러온다', async () => {
    const getArgument = vi.fn().mockResolvedValue('gpt-5.6-terra');
    vi.stubGlobal('risuai', { getArgument });

    await expect(loadModel()).resolves.toBe('gpt-5.6-terra');
    expect(getArgument).toHaveBeenCalledWith('model');
  });

  it.each([undefined, '', '  '])('값이 %s이면 기본 모델을 반환한다', async (value) => {
    vi.stubGlobal('risuai', { getArgument: vi.fn().mockResolvedValue(value) });

    await expect(loadModel()).resolves.toBe('gpt-5.6-sol');
  });
});

describe('service tier settings', () => {
  it('저장된 flex 티어를 불러온다', async () => {
    const getArgument = vi.fn().mockResolvedValue('flex');
    vi.stubGlobal('risuai', { getArgument });

    await expect(loadServiceTier()).resolves.toBe('flex');
    expect(getArgument).toHaveBeenCalledWith('service_tier');
  });

  it.each([undefined, '', 'unknown'])('값이 %s이면 default로 불러온다', async (value) => {
    vi.stubGlobal('risuai', { getArgument: vi.fn().mockResolvedValue(value) });

    await expect(loadServiceTier()).resolves.toBe('default');
  });
});
