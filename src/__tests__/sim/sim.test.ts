import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  CACHE_READ_SAVING_RATE,
  CACHE_WRITE_PREMIUM_RATE,
} from '../../ledger';
import {
  createFakeGatewayKernel,
  type FakeGatewayKernelPreset,
} from './fake-gateway';
import { createGoldenTrajectories } from './golden-trajectories';
import {
  createNoCachePolicy,
  createProductionCachePolicy,
} from './policy';
import {
  formatScoreboard,
  replayTrajectory,
  type GoldenTrajectory,
  type ReplayResult,
} from './replay';

const KERNEL_PRESETS = [
  'calibrated',
  'pessimistic',
  'optimistic',
] satisfies readonly FakeGatewayKernelPreset[];
const trajectories = createGoldenTrajectories();
const pluginStorage = new Map<string, string>();
const replayResults: ReplayResult[] = [];

function stubPluginStorage(): void {
  vi.stubGlobal('risuai', {
    pluginStorage: {
      getItem: async (key: string) => pluginStorage.get(key) ?? null,
      setItem: async (key: string, value: string) => {
        pluginStorage.set(key, value);
      },
    },
  });
}

function requireReplayResult(
  trajectory: GoldenTrajectory,
  kernelName: FakeGatewayKernelPreset,
  policyName: 'production' | 'no-cache',
): ReplayResult {
  const result = replayResults.find(
    (candidate) =>
      candidate.trajectoryId === trajectory.id &&
      candidate.kernelName === kernelName &&
      candidate.policyName === policyName,
  );
  if (result === undefined) {
    throw new Error(
      `Missing replay result for ${trajectory.id}/${kernelName}/${policyName}.`,
    );
  }
  return result;
}

function expectCommonInvariants(result: ReplayResult): void {
  expect(result.logs.length).toBeGreaterThan(0);
  result.logs.forEach((log) => {
    expect(log.readTokens + log.writeTokens).toBeLessThanOrEqual(log.inputTokens);
    expect(log.wireMarkerCount).toBeLessThanOrEqual(4);
    expect(log.policyMarkerCount).toBeLessThanOrEqual(4);
    expect(log.policyMarkerRoles).not.toContain('assistant');
    expect(log.wireMarkerRoles).not.toContain('assistant');
    expect(log.wireMarkerCount).toBe(log.policyMarkerCount);
    expect(log.markerPrefixTokens).toHaveLength(log.wireMarkerCount);
    expect(log.promptCacheKey.length).toBeLessThanOrEqual(64);

    const serializedBody = JSON.stringify(log.requestBody);
    if (log.policyMarkerCount === 0) {
      expect(serializedBody).not.toContain('prompt_cache_breakpoint');
      expect(log.readTokens).toBe(0);
      expect(log.writeTokens).toBe(0);
    } else {
      expect(serializedBody).toContain('prompt_cache_breakpoint');
    }
    expect(log.netSavedTokens).toBeCloseTo(
      log.readTokens * CACHE_READ_SAVING_RATE -
        log.writeTokens * CACHE_WRITE_PREMIUM_RATE,
    );
  });

  expect(result.totalInputTokens).toBe(
    result.logs.reduce((total, log) => total + log.inputTokens, 0),
  );
  expect(result.totalReadTokens).toBe(
    result.logs.reduce((total, log) => total + log.readTokens, 0),
  );
  expect(result.totalWriteTokens).toBe(
    result.logs.reduce((total, log) => total + log.writeTokens, 0),
  );
  expect(result.totalNetSavedTokens).toBeCloseTo(
    result.totalReadTokens * CACHE_READ_SAVING_RATE -
      result.totalWriteTokens * CACHE_WRITE_PREMIUM_RATE,
  );
}

function expectGoldenDirection(trajectory: GoldenTrajectory): void {
  const calibrated = requireReplayResult(trajectory, 'calibrated', 'production');
  const pessimistic = requireReplayResult(trajectory, 'pessimistic', 'production');
  const optimistic = requireReplayResult(trajectory, 'optimistic', 'production');

  if (trajectory.id === '01-append') {
    expect(calibrated.totalNetSavedTokens).toBeGreaterThan(0);
    expect(calibrated.totalReadTokens).toBeGreaterThan(calibrated.totalWriteTokens);
    return;
  }
  if (trajectory.id === '02-cbs-trap') {
    expect(calibrated.totalReadTokens).toBe(0);
    expect(calibrated.totalNetSavedTokens).toBeLessThanOrEqual(0);
    expect(
      Math.abs(calibrated.totalNetSavedTokens) / calibrated.totalInputTokens,
    ).toBeLessThan(0.1);
    return;
  }
  if (trajectory.id === '03-reverse-depth') {
    expect(calibrated.totalReadTokens).toBeGreaterThan(0);
    expect(calibrated.totalWriteTokens).toBeGreaterThan(0);
    expect(calibrated.totalNetSavedTokens).toBeGreaterThan(0);
    return;
  }
  if (trajectory.id === '04-reroll') {
    expect(calibrated.totalReadTokens).toBeGreaterThan(0);
    expect(calibrated.totalNetSavedTokens).toBeGreaterThan(0);
    return;
  }
  if (trajectory.id === '05-lore-toggle') {
    expect(calibrated.totalReadTokens).toBeGreaterThan(calibrated.totalWriteTokens);
    expect(calibrated.totalNetSavedTokens).toBeGreaterThan(0);
    return;
  }
  if (trajectory.id === '06-context-trim') {
    expect(calibrated.totalReadTokens).toBeGreaterThan(0);
    expect(calibrated.totalNetSavedTokens).toBeGreaterThan(0);
    return;
  }
  if (trajectory.id === '07-hypa-summary') {
    expect(calibrated.totalReadTokens).toBeGreaterThan(0);
    expect(calibrated.totalWriteTokens).toBeGreaterThan(0);
    expect(calibrated.logs.slice(-4).every((log) => log.writeTokens > 0)).toBe(true);
    expect(calibrated.totalNetSavedTokens).toBeGreaterThan(0);
    return;
  }
  if (trajectory.id === '08-lua-post-edit') {
    expect(calibrated.totalReadTokens).toBeGreaterThan(0);
    expect(calibrated.totalNetSavedTokens).toBeGreaterThan(0);
    return;
  }
  if (trajectory.id === '09-room-switch') {
    expect(calibrated.totalReadTokens).toBe(0);
    expect(calibrated.totalNetSavedTokens).toBeLessThan(0);
    expect(calibrated.logs.map((log) => log.consecutiveEpochResets)).toEqual([0, 1, 0]);
    expect(optimistic.totalNetSavedTokens).toBeGreaterThan(calibrated.totalNetSavedTokens);
    return;
  }
  if (trajectory.id === '10-ttl-gap') {
    expect(pessimistic.totalReadTokens).toBe(0);
    expect(pessimistic.totalNetSavedTokens).toBeLessThan(0);
    expect(optimistic.totalReadTokens).toBeGreaterThan(0);
    expect(optimistic.totalNetSavedTokens).toBeGreaterThan(0);
    expect(optimistic.totalNetSavedTokens).toBeGreaterThan(
      pessimistic.totalNetSavedTokens,
    );
    return;
  }
  throw new Error(`No direction assertion is defined for ${trajectory.id}.`);
}

beforeAll(async () => {
  stubPluginStorage();
  for (const trajectory of trajectories) {
    for (const kernelPreset of KERNEL_PRESETS) {
      pluginStorage.clear();
      replayResults.push(
        await replayTrajectory({
          kernel: createFakeGatewayKernel(kernelPreset),
          policy: createProductionCachePolicy(),
          trajectory,
        }),
      );

      pluginStorage.clear();
      replayResults.push(
        await replayTrajectory({
          kernel: createFakeGatewayKernel(kernelPreset),
          policy: createNoCachePolicy(),
          trajectory,
        }),
      );
    }
  }
  console.log(formatScoreboard(replayResults));
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe('deterministic replay golden trajectories', () => {
  it('실존 케이스 10개를 고정한다', () => {
    expect(trajectories).toHaveLength(10);
  });

  describe.each(trajectories)('$id $label', (trajectory) => {
    it.each(KERNEL_PRESETS)('%s kernel의 회계·와이어 불변식을 지킨다', (kernelPreset) => {
      const production = requireReplayResult(trajectory, kernelPreset, 'production');
      const noCache = requireReplayResult(trajectory, kernelPreset, 'no-cache');
      expectCommonInvariants(production);
      expectCommonInvariants(noCache);
      expect(noCache.totalReadTokens).toBe(0);
      expect(noCache.totalWriteTokens).toBe(0);
      expect(noCache.totalNetSavedTokens).toBe(0);
    });

    it('golden 방향성 기대를 지킨다', () => {
      expectGoldenDirection(trajectory);
    });
  });
});
