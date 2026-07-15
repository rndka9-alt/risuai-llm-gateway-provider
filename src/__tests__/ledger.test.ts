import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CACHE_LEDGER_STORAGE_KEY,
  accumulateCacheUsage,
  calculateNetSavedTokens,
  calculateSavedUsd,
  createEmptyCacheLedger,
  loadCacheLedger,
  resetCacheLedger,
} from '../ledger';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function stubPluginStorage(initial?: string): Map<string, string> {
  const stored = new Map<string, string>();
  if (initial !== undefined) stored.set(CACHE_LEDGER_STORAGE_KEY, initial);

  vi.stubGlobal('risuai', {
    pluginStorage: {
      getItem: async (key: string) => stored.get(key) ?? null,
      setItem: async (key: string, value: string) => {
        stored.set(key, value);
      },
    },
  });
  return stored;
}

describe('calculateNetSavedTokens', () => {
  it('읽기 0.9배 절감 − 쓰기 0.25배 프리미엄으로 계산한다', () => {
    const ledger = { ...createEmptyCacheLedger(), readTokens: 1000, writeTokens: 1000 };

    expect(calculateNetSavedTokens(ledger)).toBe(650);
  });

  it('쓰기만 있으면 음수가 된다', () => {
    const ledger = { ...createEmptyCacheLedger(), readTokens: 0, writeTokens: 400 };

    expect(calculateNetSavedTokens(ledger)).toBe(-100);
  });
});

describe('calculateSavedUsd', () => {
  it('일반 입력 단가를 역산해 읽기 절감에서 쓰기 프리미엄을 뺀다', () => {
    const savedUsd = calculateSavedUsd({
      cacheReadInputTokens: 200_000,
      cacheCreationInputTokens: 100_000,
      inputTokens: 1_300_000,
      details: {
        costDetails: {
          input_cost: 5,
          cached_input_cost: 0.1,
          cache_write_input_cost: 0.625,
        },
      },
    });

    expect(savedUsd).toBeCloseTo(0.775);
  });

  it('비용 필드가 없거나 일반 입력 토큰이 0이면 계산을 건너뛴다', () => {
    expect(calculateSavedUsd({ inputTokens: 1000 })).toBeUndefined();
    expect(calculateSavedUsd({
      cacheReadInputTokens: 800,
      cacheCreationInputTokens: 200,
      inputTokens: 1000,
      details: {
        costDetails: {
          input_cost: 0,
          cached_input_cost: 0.0004,
          cache_write_input_cost: 0.00125,
        },
      },
    })).toBeUndefined();
  });
});

describe('accumulateCacheUsage', () => {
  it('캐시 읽기/쓰기 토큰을 원장에 누적한다', async () => {
    stubPluginStorage();

    await accumulateCacheUsage(
      { cacheReadInputTokens: 1200, cacheCreationInputTokens: 300 },
      {},
      'gpt-5.6-sol',
    );
    await accumulateCacheUsage({ cacheReadInputTokens: 800 }, {}, 'gpt-5.6-sol');

    const ledger = await loadCacheLedger();
    expect(ledger.readTokens).toBe(2000);
    expect(ledger.writeTokens).toBe(300);
  });

  it('실 지출을 누적하고 마지막 응답의 관측 샘플을 저장한다', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-16T01:02:03.000Z'));
    stubPluginStorage();

    await accumulateCacheUsage(
      {
        details: {
          cost: 1.2345,
          costDetails: { prompt: 0.75, nested: { provider: 'llmgateway' } },
        },
      },
      { service_tier: 'flex' },
      'gpt-5.6-terra',
    );

    const ledger = await loadCacheLedger();
    expect(ledger.costUsd).toBe(1.2345);
    expect(ledger.lastCostSample).toEqual({
      cost: 1.2345,
      costDetails: { prompt: 0.75, nested: { provider: 'llmgateway' } },
      serviceTier: 'flex',
      model: 'gpt-5.6-terra',
      at: '2026-07-16T01:02:03.000Z',
    });
  });

  it('여러 응답의 실 지출을 합산한다', async () => {
    stubPluginStorage();

    await accumulateCacheUsage({ details: { cost: 0.1 } }, {}, 'gpt-5.6-sol');
    await accumulateCacheUsage({ details: { cost: 0.2 } }, {}, 'gpt-5.6-sol');

    expect((await loadCacheLedger()).costUsd).toBeCloseTo(0.3);
  });

  it('여러 응답의 실측 USD 절감을 합산한다', async () => {
    stubPluginStorage();
    const usage = {
      cacheReadInputTokens: 200_000,
      cacheCreationInputTokens: 100_000,
      inputTokens: 1_300_000,
      details: {
        costDetails: {
          input_cost: 5,
          cached_input_cost: 0.1,
          cache_write_input_cost: 0.625,
        },
      },
    };

    await accumulateCacheUsage(usage, {}, 'gpt-5.6-sol');
    await accumulateCacheUsage(usage, {}, 'gpt-5.6-sol');

    expect((await loadCacheLedger()).savedUsd).toBeCloseTo(1.55);
  });

  it('비용 상세 필드가 없으면 토큰은 누적하고 USD 절감만 건너뛴다', async () => {
    stubPluginStorage();

    await accumulateCacheUsage(
      {
        cacheReadInputTokens: 1200,
        cacheCreationInputTokens: 300,
        inputTokens: 2000,
        details: { costDetails: { input_cost: 0.0025 } },
      },
      {},
      'gpt-5.6-sol',
    );

    const ledger = await loadCacheLedger();
    expect(ledger.readTokens).toBe(1200);
    expect(ledger.writeTokens).toBe(300);
    expect(ledger.savedUsd).toBe(0);
  });

  it('캐시 활동과 비용이 없어도 마지막 성공 응답 샘플을 저장한다', async () => {
    const stored = stubPluginStorage();

    await accumulateCacheUsage({ inputTokens: 5000 }, {}, 'gpt-5.6-sol');
    await accumulateCacheUsage(undefined, { service_tier: 123 }, 'gpt-5.6-luna');

    expect(stored.has(CACHE_LEDGER_STORAGE_KEY)).toBe(true);
    const ledger = await loadCacheLedger();
    expect(ledger.readTokens).toBe(0);
    expect(ledger.writeTokens).toBe(0);
    expect(ledger.costUsd).toBe(0);
    expect(ledger.lastCostSample?.model).toBe('gpt-5.6-luna');
    expect(ledger.lastCostSample).not.toHaveProperty('serviceTier');
  });

  it('응답 service_tier가 null이면 샘플에는 티어를 기록하지 않는다', async () => {
    stubPluginStorage();

    await accumulateCacheUsage(undefined, { service_tier: null }, 'gpt-5.6-sol');

    expect((await loadCacheLedger()).lastCostSample).not.toHaveProperty('serviceTier');
  });
});

describe('loadCacheLedger / resetCacheLedger', () => {
  it.each([
    '',
    '{broken json',
    '{"unexpected":"shape"}',
  ])(
    '손상된 저장 값(%s)은 빈 원장으로 자가 회복한다',
    async (raw) => {
      stubPluginStorage(raw);

      const ledger = await loadCacheLedger();
      expect(ledger.readTokens).toBe(0);
      expect(ledger.writeTokens).toBe(0);
      expect(ledger.costUsd).toBe(0);
      expect(ledger.savedUsd).toBe(0);
    },
  );

  it('마지막 샘플 at이 datetime 형식이 아니어도 누적 원장을 보존한다', async () => {
    stubPluginStorage(
      JSON.stringify({
        readTokens: 120,
        since: '2026-07-01T00:00:00.000Z',
        writeTokens: 30,
        costUsd: 0.5,
        lastCostSample: { model: 'gpt-5.6-sol', at: 'provider-local-time' },
      }),
    );

    const ledger = await loadCacheLedger();

    expect(ledger.readTokens).toBe(120);
    expect(ledger.writeTokens).toBe(30);
    expect(ledger.costUsd).toBe(0.5);
    expect(ledger.savedUsd).toBe(0);
    expect(ledger.lastCostSample?.at).toBe('provider-local-time');
  });

  it('비용 필드가 없는 구버전 원장을 기본값으로 마이그레이션해 이어 쓴다', async () => {
    const since = '2026-07-01T00:00:00.000Z';
    stubPluginStorage(JSON.stringify({ readTokens: 100, since, writeTokens: 20 }));

    expect(await loadCacheLedger()).toEqual({
      readTokens: 100,
      since,
      writeTokens: 20,
      costUsd: 0,
      savedUsd: 0,
      lastCostSample: null,
    });

    await accumulateCacheUsage(
      { cacheReadInputTokens: 50, details: { cost: 0.25 } },
      {},
      'gpt-5.6-sol',
    );

    const migratedLedger = await loadCacheLedger();
    expect(migratedLedger.readTokens).toBe(150);
    expect(migratedLedger.since).toBe(since);
    expect(migratedLedger.costUsd).toBe(0.25);
    expect(migratedLedger.savedUsd).toBe(0);
  });

  it('리셋하면 0에서 다시 시작한다', async () => {
    stubPluginStorage();
    await accumulateCacheUsage(
      { cacheReadInputTokens: 500, cacheCreationInputTokens: 500, details: { cost: 0.5 } },
      {},
      'gpt-5.6-sol',
    );

    await resetCacheLedger();

    const ledger = await loadCacheLedger();
    expect(ledger.readTokens).toBe(0);
    expect(ledger.writeTokens).toBe(0);
    expect(ledger.costUsd).toBe(0);
    expect(ledger.savedUsd).toBe(0);
    expect(ledger.lastCostSample).toBeNull();
  });
});
