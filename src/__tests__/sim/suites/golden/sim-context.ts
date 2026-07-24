import { expect, vi } from 'vitest';
import { CACHE_READ_SAVING_RATE, CACHE_WRITE_PREMIUM_RATE } from '../../../../ledger';
import { createFakeGatewayKernel, type FakeGatewayKernelPreset } from '../../cache-hit-simulators';
import { createCanonicalScenarios } from '../../scenarios';
import {
  createAdaptiveTwoStrikeCachePolicy,
  createAdaptiveTwoStrikeRerollAwareCachePolicy,
  createFirstTurnSafeCachePolicy,
  createLegacyProductionCachePolicy,
  createNoCachePolicy,
  createProductionCachePolicy,
  createSelectiveHardCapCachePolicy,
  createTwoSurvivalProductionCachePolicy,
  createValidatedAllCachePolicy,
  type ReplayCachePolicy,
} from '../../cache-strategies';
import { createV013SingleSlotCachePolicy } from '../../cache-strategies/v013';
import { replayScenario, type ReplayResult } from '../../replay';
import type { SimulationScenario } from '../../scenarios';
import { formatScoreboard } from '../../reporting';

export const KERNEL_PRESETS = [
  'calibrated',
  'pessimistic',
  'optimistic',
] satisfies readonly FakeGatewayKernelPreset[];

export const scenarios = createCanonicalScenarios();

export const pluginStorage = new Map<string, string>();

export const replayResults: ReplayResult[] = [];

const POLICY_FACTORIES: readonly (() => ReplayCachePolicy)[] = [
  createLegacyProductionCachePolicy,
  createValidatedAllCachePolicy,
  createSelectiveHardCapCachePolicy,
  createTwoSurvivalProductionCachePolicy,
  createV013SingleSlotCachePolicy,
  createProductionCachePolicy,
  createAdaptiveTwoStrikeCachePolicy,
  createAdaptiveTwoStrikeRerollAwareCachePolicy,
  createFirstTurnSafeCachePolicy,
  createNoCachePolicy,
];

export const POLICY_NAMES = [
  'legacy-production',
  'validated-all',
  'selective-hard-cap',
  'production-two-survival',
  'v013-single-slot',
  'production',
  'adaptive-2strike',
  'adaptive-2strike-reroll-aware',
  'first-turn-safe',
  'no-cache',
] as const;

export type PolicyName = (typeof POLICY_NAMES)[number];

export const POSITIVE_SCENARIO_IDS = [
  '01-append',
  '03-reverse-depth',
  '04-reroll',
  '05-lore-toggle',
  '06-context-trim',
  '07-hypa-summary',
  '08-lua-post-edit',
] as const;

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

export function requireReplayResult(
  scenario: SimulationScenario,
  kernelName: FakeGatewayKernelPreset,
  policyName: PolicyName,
): ReplayResult {
  const result = replayResults.find(
    (candidate) =>
      candidate.scenarioId === scenario.id &&
      candidate.kernelName === kernelName &&
      candidate.policyName === policyName,
  );
  if (result === undefined) {
    throw new Error(`Missing replay result for ${scenario.id}/${kernelName}/${policyName}.`);
  }
  return result;
}

export function expectCommonInvariants(result: ReplayResult): void {
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
      log.readTokens * CACHE_READ_SAVING_RATE - log.writeTokens * CACHE_WRITE_PREMIUM_RATE,
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

export function requireScenarioById(scenarioId: string): SimulationScenario {
  const scenario = scenarios.find((candidate) => candidate.id === scenarioId);
  if (scenario === undefined) {
    throw new Error(`Missing canonical scenario ${scenarioId}.`);
  }
  return scenario;
}

export async function initializeReplayResults(): Promise<void> {
  for (const scenario of scenarios) {
    for (const kernelPreset of KERNEL_PRESETS) {
      for (const createPolicy of POLICY_FACTORIES) {
        // planner 상태와 wrapper 클로저를 정책·커널 실행마다 함께 격리한다.
        pluginStorage.clear();
        stubPluginStorage();
        replayResults.push(
          await replayScenario({
            kernel: createFakeGatewayKernel(kernelPreset),
            policy: createPolicy(),
            scenario,
          }),
        );
      }
    }
  }
  console.log(formatScoreboard(replayResults));
}

export function cleanupReplayGlobals(): void {
  vi.unstubAllGlobals();
}
