import { afterEach, describe, expect, it, vi } from 'vitest';
import { STYLES } from '../constants';
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
  saveConfigurableLlmFlagNames,
  saveServiceTier,
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
      streamingMode: 'decoupled',
      verbosity: 'low',
    });

    expect(setArgument).toHaveBeenCalledWith('api_key', 'llmgtwy_new_secret');
    expect(setArgument).toHaveBeenCalledWith('model', 'gpt-5.6-luna');
    expect(setArgument).toHaveBeenCalledWith('prompt_cache_mode', 'explicit');
    expect(setArgument).toHaveBeenCalledWith('service_tier', 'flex');
    expect(setArgument).toHaveBeenCalledWith('reasoning_effort', 'xhigh');
    expect(setArgument).toHaveBeenCalledWith('verbosity', 'low');
    expect(setArgument).toHaveBeenCalledWith('streaming_mode', 'decoupled');
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
    const getArgument = vi.fn().mockResolvedValue('flex');
    vi.stubGlobal('risuai', { getArgument });

    await expect(loadServiceTier()).resolves.toBe('flex');
    expect(getArgument).toHaveBeenCalledWith('service_tier');
  });

  it.each([undefined, '', 'default', 'unknown'])(
    '값이 %s이면 Gateway 기본값을 따르도록 미지정으로 불러온다',
    async (value) => {
      vi.stubGlobal('risuai', { getArgument: vi.fn().mockResolvedValue(value) });

      await expect(loadServiceTier()).resolves.toBeUndefined();
    },
  );

  it('Flex 비활성화는 저장값을 비워 요청에서 생략되게 한다', async () => {
    const setArgument = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('risuai', { setArgument });

    await saveServiceTier(undefined);

    expect(setArgument).toHaveBeenCalledWith('service_tier', '');
  });

  it('Flex 활성화는 flex를 저장한다', async () => {
    const setArgument = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('risuai', { setArgument });

    await saveServiceTier('flex');

    expect(setArgument).toHaveBeenCalledWith('service_tier', 'flex');
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

  it('기존 stream 저장값은 decoupled로 불러온다', async () => {
    vi.stubGlobal('risuai', { getArgument: vi.fn().mockResolvedValue('stream') });

    await expect(loadStreamingMode()).resolves.toBe('decoupled');
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

  it('모든 flags 해제 상태를 none sentinel로 저장하고 복원한다', async () => {
    const setArgument = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('risuai', {
      getArgument: vi.fn().mockResolvedValue('none'),
      setArgument,
    });

    await saveConfigurableLlmFlagNames([]);

    expect(setArgument).toHaveBeenCalledWith('flags', 'none');
    await expect(loadConfigurableLlmFlagNames()).resolves.toEqual([]);
  });
});

describe('settings UI', () => {
  it('필드 캡션과 활성 flag 체크박스를 렌더링한다', () => {
    const html = createSettingsHtml('gpt-5.6-sol');

    for (const caption of [
      'API 키',
      '캐시 모드',
      'Reasoning effort',
      'Verbosity',
      '응답 방식',
      '고급',
      '모델',
      '서비스 티어',
      'LLM flags',
    ]) {
      expect(html).toContain(`>${caption}<`);
    }
    expect(html).toContain('id="reasoning-effort"');
    expect(html).toContain('id="verbosity"');
    expect(html).toContain('id="flag-hasFullSystemPrompt"');
    expect(html).toContain('id="flag-poolSupported"');
    expect(html).not.toContain('flag-hasStreaming');
  });

  it('API key를 password 입력과 표시 토글로 렌더링한다', () => {
    const html = createSettingsHtml('gpt-5.6-sol');

    expect(html).toContain('<input id="api-key" type="password"');
    expect(html).toContain('id="api-key-visibility"');
    expect(html).toContain('aria-label="API 키 표시"');
    expect(html).toContain('<svg viewBox="0 0 24 24" aria-hidden="true">');
  });

  it('스트리밍을 off와 decoupled 사이의 스위치로 렌더링한다', () => {
    const html = createSettingsHtml('gpt-5.6-sol');

    expect(html).toContain(
      '<input id="streaming-mode" class="switch-input" type="checkbox" role="switch"',
    );
    expect(html).toContain('<span id="streaming-mode-label">일반 요청</span>');
    expect(html).not.toContain('<select id="streaming-mode"');
    expect(html).not.toContain('<option value="stream">');
  });

  it('서비스 티어를 Gateway 기본과 Flex 사이의 스위치로 렌더링한다', () => {
    const html = createSettingsHtml('gpt-5.6-sol');

    expect(html).toContain(
      '<input id="service-tier" class="switch-input" type="checkbox" role="switch"',
    );
    expect(html).toContain('<span id="service-tier-label">Gateway 기본</span>');
    expect(html).not.toContain('id="service-tier-default"');
    expect(html).not.toContain('<select id="service-tier"');
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
    expect(html).toContain('id="close" class="close-button"');
  });

  it('상시 노출은 손익 대표 금액이고 리셋 버튼은 팝오버 밖 요약 옆에 렌더링한다', () => {
    const html = createSettingsHtml('gpt-5.6-sol');
    const popoverStart = html.indexOf('id="ledger-popover"');
    const resetButton = html.indexOf('id="ledger-reset"');

    expect(html).toContain('aria-label="캐시 손익 상세"');
    expect(html).toContain('<span id="ledger-amount-summary" class="amount neutral"></span>');
    // 읽기/쓰기 원시값은 상시 노출이 아니라 팝오버 상세로만 보여준다.
    expect(html).not.toContain('ledger-read-summary');
    expect(html).toContain('<span>읽기</span><span id="ledger-read-detail">0</span>');
    // 지출 행은 UI에서 제거됨 — 누적(costUsd) 자체는 원장에 계속 쌓인다.
    expect(html).not.toContain('ledger-cost-detail');
    expect(html).toContain('<span>캐시 손익</span><span id="ledger-amount"></span>');
    expect(resetButton).toBeGreaterThan(-1);
    expect(resetButton).toBeLessThan(popoverStart);
  });

  it('accent 강조와 대비형 닫기 버튼을 테마 변수로 구성한다', () => {
    expect(STYLES).toContain(
      'background:color-mix(in srgb,var(--accent) 22%,var(--background))',
    );
    expect(STYLES).toContain(
      'background:color-mix(in srgb,var(--text) 88%,var(--background))',
    );
    expect(STYLES).toContain('.ledger .amount.gain { color:#4ade80; }');
    expect(STYLES).toContain('.ledger .amount.loss { color:#f87171; }');
  });

  it('손익과 닫기 영역을 스크롤 컨테이너 하단에 고정한다', () => {
    expect(STYLES).toContain(
      '.settings-footer { position:sticky; z-index:1; bottom:0;',
    );
    expect(STYLES).toContain('background:var(--background2); }');
  });

  it('재등록 대상인 flags 순서와 무관하게 동일한 설정으로 판별한다', () => {
    expect(createProviderRegistrationSignature({
      flagNames: ['poolSupported', 'hasFullSystemPrompt'],
    })).toBe(createProviderRegistrationSignature({
      flagNames: ['hasFullSystemPrompt', 'poolSupported'],
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
