import { afterEach, describe, expect, it, vi } from 'vitest';
import { PRESET_SCHEMES } from '../constants';
import { resolveScheme } from '../theme';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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
