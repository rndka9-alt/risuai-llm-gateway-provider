import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyCacheLedger } from '../ledger';
import {
  formatLedgerSummary,
  formatTokenCount,
  createProviderRegistrationSignature,
  createSettingsHtml,
  loadApiKey,
  loadConfigurableLlmFlagNames,
  loadModel,
  loadPromptCacheMode,
  loadReasoningEffort,
  loadServiceTier,
  loadStreamingMode,
  loadVerbosity,
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

  it('전체 설정값을 함께 저장한다', async () => {
    const setArgument = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('risuai', { setArgument });

    await saveSettings({
      apiKey: 'llmgtwy_new_secret',
      flagNames: ['hasFullSystemPrompt', 'poolSupported'],
      model: 'gpt-5.6-luna',
      promptCacheMode: 'explicit',
      reasoningEffort: 'xhigh',
      serviceTier: 'flex',
      streamingMode: 'stream',
      verbosity: 'low',
    });

    expect(setArgument).toHaveBeenCalledWith('api_key', 'llmgtwy_new_secret');
    expect(setArgument).toHaveBeenCalledWith('model', 'gpt-5.6-luna');
    expect(setArgument).toHaveBeenCalledWith('prompt_cache_mode', 'explicit');
    expect(setArgument).toHaveBeenCalledWith('service_tier', 'flex');
    expect(setArgument).toHaveBeenCalledWith('reasoning_effort', 'xhigh');
    expect(setArgument).toHaveBeenCalledWith('verbosity', 'low');
    expect(setArgument).toHaveBeenCalledWith('streaming_mode', 'stream');
    expect(setArgument).toHaveBeenCalledWith(
      'flags',
      'hasFullSystemPrompt,poolSupported',
    );
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

describe('ledger display', () => {
  it('토큰 수를 k/M 단위로 축약한다', () => {
    expect(formatTokenCount(120)).toBe('120');
    expect(formatTokenCount(12_300)).toBe('12.3k');
    expect(formatTokenCount(-1_500_000)).toBe('-1.5M');
  });

  it('기록이 없으면 안내 문구를 보여준다', () => {
    expect(formatLedgerSummary(createEmptyCacheLedger())).toBe('캐시 손익: 아직 기록 없음');
  });

  it('순절감과 읽기/쓰기 원시값을 함께 보여준다', () => {
    const ledger = { ...createEmptyCacheLedger(), readTokens: 10_000, writeTokens: 4_000 };

    expect(formatLedgerSummary(ledger)).toBe('캐시 손익: +8.0k tokens (읽기 10.0k / 쓰기 4.0k)');
  });

  it('실 지출이 있으면 USD 합계를 소수점 넷째 자리까지 병기한다', () => {
    const ledger = {
      ...createEmptyCacheLedger(),
      readTokens: 10_000,
      writeTokens: 4_000,
      costUsd: 1.2345,
    };

    expect(formatLedgerSummary(ledger)).toBe(
      '캐시 손익: +8.0k tokens · 지출 $1.2345 (읽기 10.0k / 쓰기 4.0k)',
    );
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

describe('generation option settings', () => {
  it('reasoning_effort와 verbosity 선택값을 불러온다', async () => {
    const getArgument = vi.fn(async (key: string) => {
      if (key === 'reasoning_effort') return 'high';
      if (key === 'verbosity') return 'medium';
      return undefined;
    });
    vi.stubGlobal('risuai', { getArgument });

    await expect(loadReasoningEffort()).resolves.toBe('high');
    await expect(loadVerbosity()).resolves.toBe('medium');
  });

  it('미지정 선택값은 undefined로 불러온다', async () => {
    vi.stubGlobal('risuai', { getArgument: vi.fn().mockResolvedValue('') });

    await expect(loadReasoningEffort()).resolves.toBeUndefined();
    await expect(loadVerbosity()).resolves.toBeUndefined();
  });

  it('streaming_mode 기본값은 off다', async () => {
    vi.stubGlobal('risuai', { getArgument: vi.fn().mockResolvedValue(undefined) });

    await expect(loadStreamingMode()).resolves.toBe('off');
  });

  it('flags 미지정 기본값과 저장값을 판별한다', async () => {
    const getArgument = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce('hasFirstSystemPrompt,poolSupported');
    vi.stubGlobal('risuai', { getArgument });

    await expect(loadConfigurableLlmFlagNames()).resolves.toEqual(['hasFullSystemPrompt']);
    await expect(loadConfigurableLlmFlagNames()).resolves.toEqual([
      'hasFirstSystemPrompt',
      'poolSupported',
    ]);
  });
});

describe('settings UI', () => {
  it('선택 인자와 활성 flag 체크박스를 렌더링한다', () => {
    const html = createSettingsHtml('gpt-5.6-sol');

    expect(html).toContain('id="reasoning-effort"');
    expect(html).toContain('Reasoning effort · 지정 안 함');
    expect(html).toContain('id="verbosity"');
    expect(html).toContain('Verbosity · 지정 안 함');
    expect(html).toContain('id="streaming-mode"');
    expect(html).toContain('id="flag-hasFullSystemPrompt"');
    expect(html).toContain('id="flag-poolSupported"');
    expect(html).not.toContain('flag-hasStreaming');
  });

  it.each(['Image Input', 'Image Output', 'Audio Input', 'Audio Output', 'Video Input'])(
    '%s는 disabled 미지원 항목으로 렌더링한다',
    (label) => {
      const html = createSettingsHtml('gpt-5.6-sol');
      expect(html).toContain(`<span>${label} · 미지원</span>`);
    },
  );

  it('재등록 대상인 flags 순서와 무관하게 동일한 설정으로 판별한다', () => {
    expect(createProviderRegistrationSignature({
      flagNames: ['poolSupported', 'hasFullSystemPrompt'],
      streamingMode: 'decoupled',
    })).toBe(createProviderRegistrationSignature({
      flagNames: ['hasFullSystemPrompt', 'poolSupported'],
      streamingMode: 'decoupled',
    }));
  });

  it('저장 후 재등록 안내 문구를 포함한다', () => {
    expect(createSettingsHtml('gpt-5.6-sol')).toContain(
      '적용하려면 새로고침이 필요합니다.',
    );
  });
});
