import { afterEach, describe, expect, it, vi } from 'vitest';
import { initializeConfigOnStartup, loadConfig, saveConfig } from '../config';

const CONFIG_STORAGE_KEY = 'llm-gateway-provider:config';
const LEGACY_ARGUMENT_BACKUP_STORAGE_KEY = 'llm-gateway-provider:arguments-backup';

const DEFAULT_CONFIG = {
  api_key: '',
  extra_body: '',
  flags: '',
  model: '',
  prompt_cache_mode: '',
  reasoning_effort: '',
  service_tier: '',
  streaming_mode: '',
  verbosity: '',
};

interface ConfigHarness {
  argumentsByName: Map<string, string>;
  getArgument: ReturnType<typeof vi.fn<(name: string) => Promise<string | undefined>>>;
  storage: Map<string, string>;
}

function stubConfig(
  options: {
    argumentValues?: Readonly<Record<string, string>>;
    configValue?: string;
    legacyBackupValue?: string;
  } = {},
): ConfigHarness {
  const argumentsByName = new Map(Object.entries(options.argumentValues ?? {}));
  const storage = new Map<string, string>();
  if (options.configValue !== undefined) {
    storage.set(CONFIG_STORAGE_KEY, options.configValue);
  }
  if (options.legacyBackupValue !== undefined) {
    storage.set(LEGACY_ARGUMENT_BACKUP_STORAGE_KEY, options.legacyBackupValue);
  }
  const getArgument = vi.fn(async (name: string) => argumentsByName.get(name));

  vi.stubGlobal('risuai', {
    getArgument,
    pluginStorage: {
      getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
      setItem: vi.fn(async (key: string, value: string) => {
        storage.set(key, value);
      }),
    },
  });
  return { argumentsByName, getArgument, storage };
}

function requireStoredConfig(harness: ConfigHarness): Record<string, unknown> {
  const serialized = harness.storage.get(CONFIG_STORAGE_KEY);
  if (serialized === undefined) throw new Error('Expected stored config');
  const parsed: unknown = JSON.parse(serialized);
  if (!isRecord(parsed)) throw new Error('Expected config object');
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('config storage', () => {
  it('설정을 하나의 JSON으로 저장하고 다시 불러온다', async () => {
    const harness = stubConfig();

    await saveConfig({
      api_key: 'llmgtwy_secret',
      extra_body: '',
      flags: 'hasFirstSystemPrompt,poolSupported',
      model: 'gpt-5.6-luna',
      prompt_cache_mode: 'disabled',
      reasoning_effort: 'xhigh',
      service_tier: 'flex',
      streaming_mode: 'decoupled',
      verbosity: 'low',
    });

    await expect(loadConfig()).resolves.toEqual({
      api_key: 'llmgtwy_secret',
      extra_body: '',
      flags: 'hasFirstSystemPrompt,poolSupported',
      model: 'gpt-5.6-luna',
      prompt_cache_mode: 'disabled',
      reasoning_effort: 'xhigh',
      service_tier: 'flex',
      streaming_mode: 'decoupled',
      verbosity: 'low',
    });
    expect(requireStoredConfig(harness)).toMatchObject({ model: 'gpt-5.6-luna' });
  });

  it('저장된 config가 없으면 기본값을 반환한다', async () => {
    stubConfig();

    await expect(loadConfig()).resolves.toEqual(DEFAULT_CONFIG);
  });

  it('의도적으로 빈 값을 저장하면 그대로 원천 설정이 된다', async () => {
    stubConfig({ configValue: JSON.stringify({ api_key: 'old-secret' }) });

    await saveConfig({ api_key: '' });

    await expect(loadConfig()).resolves.toMatchObject({ api_key: '' });
  });

  it('손상된 config를 기본값으로 자가 회복한다', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const harness = stubConfig({
      argumentValues: { api_key: 'real-arg-secret' },
      configValue: '{broken json',
      legacyBackupValue: JSON.stringify({ api_key: 'backup-secret' }),
    });

    await expect(initializeConfigOnStartup()).resolves.toEqual(DEFAULT_CONFIG);

    expect(harness.getArgument).not.toHaveBeenCalled();
    expect(requireStoredConfig(harness)).toEqual(DEFAULT_CONFIG);
    expect(consoleError).toHaveBeenCalled();
  });
});

describe('legacy config migration', () => {
  it('설정 이력이 전혀 없는 첫 설치에는 Flex를 시드한다', async () => {
    const harness = stubConfig();

    await expect(initializeConfigOnStartup()).resolves.toEqual({
      ...DEFAULT_CONFIG,
      service_tier: 'flex',
    });
    expect(requireStoredConfig(harness)).toEqual({
      ...DEFAULT_CONFIG,
      service_tier: 'flex',
    });
  });

  it.each([
    ['Gateway 기본', ''],
    ['구버전 Gateway 기본', 'default'],
    ['Flex', 'flex'],
  ])('저장 config의 기존 %s 선택을 유지한다', async (_label, serviceTier) => {
    const harness = stubConfig({
      configValue: JSON.stringify({ service_tier: serviceTier }),
    });

    await expect(initializeConfigOnStartup()).resolves.toMatchObject({
      service_tier: serviceTier,
    });
    expect(harness.getArgument).not.toHaveBeenCalled();
  });

  it('빈 구 argument backup도 기존 설치 이력으로 보고 Gateway 기본을 유지한다', async () => {
    const harness = stubConfig({ legacyBackupValue: JSON.stringify({}) });

    await expect(initializeConfigOnStartup()).resolves.toEqual(DEFAULT_CONFIG);
    expect(harness.getArgument).not.toHaveBeenCalled();
  });

  it('손상된 구 argument backup도 첫 설치로 오인하지 않는다', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const harness = stubConfig({ legacyBackupValue: '{broken json' });

    await expect(initializeConfigOnStartup()).resolves.toEqual(DEFAULT_CONFIG);
    expect(requireStoredConfig(harness)).toEqual(DEFAULT_CONFIG);
    expect(consoleError).toHaveBeenCalled();
  });

  it('config가 없으면 구 argument backup을 우선 승격한다', async () => {
    const harness = stubConfig({
      argumentValues: { api_key: 'real-arg-secret' },
      legacyBackupValue: JSON.stringify({
        api_key: 'backup-secret',
        flags: 'poolSupported',
        model: 'gpt-5.6-terra',
        service_tier: 'flex',
      }),
    });

    await expect(initializeConfigOnStartup()).resolves.toMatchObject({
      api_key: 'backup-secret',
      flags: 'poolSupported',
      model: 'gpt-5.6-terra',
      service_tier: 'flex',
    });
    expect(harness.getArgument).not.toHaveBeenCalled();
    expect(requireStoredConfig(harness)).toMatchObject({ api_key: 'backup-secret' });
  });

  it('구 backup도 없으면 realArg 설정을 이식한다', async () => {
    const harness = stubConfig({
      argumentValues: {
        api_key: 'real-arg-secret',
        model: 'gpt-5.6-luna',
        reasoning_effort: 'high',
        service_tier: 'flex',
      },
    });

    await expect(initializeConfigOnStartup()).resolves.toMatchObject({
      api_key: 'real-arg-secret',
      model: 'gpt-5.6-luna',
      reasoning_effort: 'high',
      service_tier: 'flex',
    });
    expect(requireStoredConfig(harness)).toMatchObject({
      api_key: 'real-arg-secret',
      model: 'gpt-5.6-luna',
    });
  });

  it('realArg에서는 비어있지 않은 값만 이식한다', async () => {
    stubConfig({
      argumentValues: {
        api_key: '',
        flags: '',
        model: 'gpt-5.6-terra',
        service_tier: '',
      },
    });

    await expect(initializeConfigOnStartup()).resolves.toEqual({
      ...DEFAULT_CONFIG,
      model: 'gpt-5.6-terra',
    });
  });

  it('config가 생긴 뒤에는 legacy 값을 다시 읽지 않는다', async () => {
    const harness = stubConfig({ argumentValues: { model: 'gpt-5.6-sol' } });

    await initializeConfigOnStartup();
    harness.argumentsByName.set('model', 'gpt-5.6-luna');
    const firstMigrationReadCount = harness.getArgument.mock.calls.length;

    await expect(initializeConfigOnStartup()).resolves.toMatchObject({
      model: 'gpt-5.6-sol',
    });
    expect(harness.getArgument).toHaveBeenCalledTimes(firstMigrationReadCount);
  });
});
