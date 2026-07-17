import { afterEach, describe, expect, it, vi } from 'vitest';
import { API_KEY_ARGUMENT } from '../argument-backup';
import { MODEL_ARGUMENT } from '../options';

interface ArgumentBackupHarness {
  argumentsByName: Map<string, string>;
  backupStorage: { value: string | undefined };
  setArgument: ReturnType<typeof vi.fn<(name: string, value: string) => Promise<void>>>;
}

function stubArgumentBackup(
  argumentValues: Readonly<Record<string, string>> = {},
  storedBackup: string | undefined = undefined,
): ArgumentBackupHarness {
  const argumentsByName = new Map(Object.entries(argumentValues));
  const backupStorage = { value: storedBackup };
  const getItem = vi.fn(async (_key: string) => {
    return backupStorage.value ?? null;
  });
  const setItem = vi.fn(async (_key: string, value: string) => {
    backupStorage.value = value;
  });
  const setArgument = vi.fn(async (name: string, value: string) => {
    argumentsByName.set(name, value);
  });

  vi.stubGlobal('risuai', {
    getArgument: vi.fn(async (name: string) => argumentsByName.get(name)),
    setArgument,
    pluginStorage: { getItem, setItem },
  });
  return { argumentsByName, backupStorage, setArgument };
}

function requireStoredBackup(harness: ArgumentBackupHarness): Record<string, unknown> {
  const serialized = harness.backupStorage.value;
  if (serialized === undefined) throw new Error('Expected a stored argument backup');
  const parsed: unknown = JSON.parse(serialized);
  if (!isRecord(parsed)) {
    throw new Error('Expected argument backup to be an object');
  }
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('argument backup startup synchronization', () => {
  it('빈 인자를 백업 값으로 복원한다', async () => {
    const harness = stubArgumentBackup(
      { [API_KEY_ARGUMENT]: '' },
      JSON.stringify({ [API_KEY_ARGUMENT]: 'restored-secret' }),
    );
    const { initializeArgumentBackupOnStartup } = await import('../argument-backup');

    await initializeArgumentBackupOnStartup();

    expect(harness.setArgument).toHaveBeenCalledWith(
      API_KEY_ARGUMENT,
      'restored-secret',
    );
    expect(harness.argumentsByName.get(API_KEY_ARGUMENT)).toBe('restored-secret');
  });

  it('현재 인자가 비어있지 않으면 백업으로 덮어쓰지 않고 현재 값을 병합한다', async () => {
    const harness = stubArgumentBackup(
      { [API_KEY_ARGUMENT]: 'current-secret' },
      JSON.stringify({ [API_KEY_ARGUMENT]: 'old-secret' }),
    );
    const { initializeArgumentBackupOnStartup } = await import('../argument-backup');

    await initializeArgumentBackupOnStartup();

    expect(harness.setArgument).not.toHaveBeenCalled();
    expect(requireStoredBackup(harness)).toMatchObject({
      [API_KEY_ARGUMENT]: 'current-secret',
    });
  });

  it('손상 백업을 무시하고 현재 비어있지 않은 인자로 새 백업을 만든다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const harness = stubArgumentBackup(
      { [MODEL_ARGUMENT]: 'gpt-5.6-luna' },
      '{broken json',
    );
    const { initializeArgumentBackupOnStartup } = await import('../argument-backup');

    await expect(initializeArgumentBackupOnStartup()).resolves.toBeUndefined();

    expect(harness.setArgument).not.toHaveBeenCalled();
    expect(requireStoredBackup(harness)).toEqual({
      [MODEL_ARGUMENT]: 'gpt-5.6-luna',
    });
  });

  it('부팅 병합은 빈 값을 백업에 넣지 않는다', async () => {
    const harness = stubArgumentBackup({
      [API_KEY_ARGUMENT]: '',
      [MODEL_ARGUMENT]: 'gpt-5.6-terra',
    });
    const { initializeArgumentBackupOnStartup } = await import('../argument-backup');

    await initializeArgumentBackupOnStartup();

    expect(requireStoredBackup(harness)).toEqual({
      [MODEL_ARGUMENT]: 'gpt-5.6-terra',
    });
  });
});

describe('settings argument backup updates', () => {
  it('저장 훅 경유 변경을 기존 백업에 병합한다', async () => {
    const harness = stubArgumentBackup();
    const { setArgumentWithBackup } = await import('../argument-backup');

    await setArgumentWithBackup(API_KEY_ARGUMENT, 'new-secret');
    await setArgumentWithBackup(MODEL_ARGUMENT, 'gpt-5.6-luna');

    expect(requireStoredBackup(harness)).toEqual({
      [API_KEY_ARGUMENT]: 'new-secret',
      [MODEL_ARGUMENT]: 'gpt-5.6-luna',
    });
  });

  it('사용자가 빈 값으로 저장하면 이전 백업도 제거한다', async () => {
    const harness = stubArgumentBackup(
      { [API_KEY_ARGUMENT]: 'old-secret' },
      JSON.stringify({ [API_KEY_ARGUMENT]: 'old-secret' }),
    );
    const { setArgumentWithBackup } = await import('../argument-backup');

    await setArgumentWithBackup(API_KEY_ARGUMENT, '');

    expect(requireStoredBackup(harness)).toEqual({});
  });
});
