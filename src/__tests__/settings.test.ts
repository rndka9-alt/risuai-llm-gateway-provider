import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyCacheLedger } from '../ledger';
import {
  buildLedgerDisplay,
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

  it('저장된 disabled 모드를 불러온다', async () => {
    vi.stubGlobal('risuai', { getArgument: vi.fn().mockResolvedValue('disabled') });

    await expect(loadPromptCacheMode()).resolves.toBe('disabled');
  });

  it.each([undefined, '', 'unknown'])('값이 %s이면 기본값 explicit로 불러온다', async (value) => {
    vi.stubGlobal('risuai', { getArgument: vi.fn().mockResolvedValue(value) });

    await expect(loadPromptCacheMode()).resolves.toBe('explicit');
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

  it('기록이 없으면 안내 문구를 중립 톤으로 보여준다', () => {
    expect(buildLedgerDisplay(createEmptyCacheLedger())).toEqual({
      amountText: '아직 기록 없음',
      detailText: '',
      tone: 'neutral',
    });
  });

  it('절감 USD가 없으면 토큰 등가를 이득 톤으로 보여준다', () => {
    const ledger = { ...createEmptyCacheLedger(), readTokens: 10_000, writeTokens: 4_000 };

    expect(buildLedgerDisplay(ledger)).toEqual({
      amountText: '+8.0k tokens',
      detailText: '(읽기 10.0k / 쓰기 4.0k)',
      tone: 'gain',
    });
  });

  it('실 지출은 디테일에 병기한다', () => {
    const ledger = {
      ...createEmptyCacheLedger(),
      readTokens: 10_000,
      writeTokens: 4_000,
      costUsd: 1.2345,
    };

    expect(buildLedgerDisplay(ledger).detailText).toBe('(읽기 10.0k / 쓰기 4.0k / 지출 $1.2345)');
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

  it('미디어 항목은 Image Input 하나만 disabled 미지원으로 렌더링한다', () => {
    const html = createSettingsHtml('gpt-5.6-sol');

    expect(html).toContain('<span>Image Input · 미지원</span>');
    for (const removedLabel of ['Image Output', 'Audio Input', 'Audio Output', 'Video Input']) {
      expect(html).not.toContain(removedLabel);
    }
  });

  it('저장 버튼 없이 닫기 버튼만 렌더링한다', () => {
    const html = createSettingsHtml('gpt-5.6-sol');

    expect(html).not.toContain('id="save"');
    expect(html).toContain('id="close"');
  });

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

  it('캐시 백오프 진단 문구를 원장 근처에 포함한다', () => {
    expect(createSettingsHtml('gpt-5.6-sol')).toContain(
      '⚠️ 프롬프트 앞부분이 매턴 바뀌어 캐시를 일시 중단했어요. ' +
      '프리셋의 {{time}}/{{random}}/확률 로어북을 확인해보세요',
    );
  });
});
