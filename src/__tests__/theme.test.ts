// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PRESET_SCHEMES } from '../constants';
import { applyTheme, resolveScheme } from '../theme';

afterEach(() => {
  document.documentElement.removeAttribute('style');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('applyTheme', () => {
  it('RisuAI 컬러스킴을 iframe Tailwind 브릿지 CSS 변수로 적용한다', () => {
    const scheme = PRESET_SCHEMES['galaxy'];

    applyTheme(scheme);

    const style = document.documentElement.style;
    expect(style.getPropertyValue('--background')).toBe(scheme.bgcolor);
    expect(style.getPropertyValue('--background2')).toBe(scheme.darkbg);
    expect(style.getPropertyValue('--border2')).toBe(scheme.darkBorderc);
    expect(style.getPropertyValue('--text')).toBe(scheme.textcolor);
    expect(style.getPropertyValue('--text2')).toBe(scheme.textcolor2);
    expect(style.getPropertyValue('--accent')).toBe(scheme.selected);
  });
});

describe('resolveScheme', () => {
  it('getColorScheme 결과를 우선 사용한다', async () => {
    const scheme = { ...PRESET_SCHEMES['light'] };
    const getDatabase = vi.fn();
    vi.stubGlobal('risuai', {
      getColorScheme: vi.fn().mockResolvedValue({ name: 'custom', scheme }),
      getDatabase,
    });

    await expect(resolveScheme()).resolves.toEqual(scheme);
    expect(getDatabase).not.toHaveBeenCalled();
  });

  it('getColorScheme 실패 시 현재 프리셋으로 대체한다', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal('risuai', {
      getColorScheme: vi.fn().mockRejectedValue(new Error('unsupported')),
      getDatabase: vi.fn().mockResolvedValue({ colorSchemeName: 'galaxy' }),
    });

    await expect(resolveScheme()).resolves.toEqual(PRESET_SCHEMES['galaxy']);
  });

  it('알 수 없는 프리셋은 기본 테마로 대체한다', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal('risuai', {
      getColorScheme: vi.fn().mockRejectedValue(new Error('unsupported')),
      getDatabase: vi.fn().mockResolvedValue({ colorSchemeName: 'unknown' }),
    });

    await expect(resolveScheme()).resolves.toEqual(PRESET_SCHEMES['default']);
  });
});
