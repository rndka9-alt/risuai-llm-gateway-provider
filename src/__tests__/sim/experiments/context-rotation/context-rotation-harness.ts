import { expect, vi } from 'vitest';
import { CACHE_READ_SAVING_RATE, CACHE_WRITE_PREMIUM_RATE } from '../../../../ledger';
import { createCacheHitSimulator } from '../../cache-hit-simulators';
import {
  createNoCachePolicy,
  createProductionCachePolicy,
  type ReplayCachePolicy,
} from '../../cache-strategies';
import { createV013SingleSlotCachePolicy } from '../../cache-strategies/v013';
import { replayScenario, type ReplayResult } from '../../replay';
import {
  createStableHeadOraclePolicy,
  createSurvivingFrontierOraclePolicy,
} from './context-rotation-oracles';
import {
  summarizeContextRotationReplay,
  type ContextRotationRunSummary,
} from './context-rotation-metrics';
import type { ContextRotationScenario } from './context-rotation-scenarios';

export interface ContextRotationPolicyFactory {
  create: (scenario: ContextRotationScenario) => ReplayCachePolicy;
  name: string;
}

export const FULL_POLICY_FACTORIES: readonly ContextRotationPolicyFactory[] = [
  { create: () => createNoCachePolicy(), name: 'no-cache' },
  { create: () => createV013SingleSlotCachePolicy(), name: 'v013-single-slot' },
  { create: () => createProductionCachePolicy(), name: 'production' },
  { create: (scenario) => createStableHeadOraclePolicy(scenario), name: 'oracle-stable-head' },
  {
    create: (scenario) => createSurvivingFrontierOraclePolicy(scenario),
    name: 'oracle-surviving-frontier',
  },
];

// 기본 test:sim 실행을 무겁게 하지 않도록 스모크는 릴리즈 안전선(v013)을 뺀다.
export const SMOKE_POLICY_FACTORIES: readonly ContextRotationPolicyFactory[] =
  FULL_POLICY_FACTORIES.filter((factory) => factory.name !== 'v013-single-slot');

export const pluginStorage = new Map<string, string>();

export function stubPluginStorage(): void {
  vi.stubGlobal('risuai', {
    pluginStorage: {
      getItem: async (key: string) => pluginStorage.get(key) ?? null,
      setItem: async (key: string, value: string) => {
        pluginStorage.set(key, value);
      },
    },
  });
}

export function assertReplayInvariants(result: ReplayResult): void {
  expect(result.logs.length).toBeGreaterThan(0);
  result.logs.forEach((log) => {
    expect(log.readTokens + log.writeTokens).toBeLessThanOrEqual(log.inputTokens);
    expect(log.wireMarkerCount).toBeLessThanOrEqual(4);
    expect(log.policyMarkerRoles).not.toContain('assistant');
    expect(log.wireMarkerRoles).not.toContain('assistant');
    expect(log.netSavedTokens).toBeCloseTo(
      log.readTokens * CACHE_READ_SAVING_RATE - log.writeTokens * CACHE_WRITE_PREMIUM_RATE,
    );
  });
}

// replay 직후 스칼라 요약만 남기고 ReplayResult(요청 전문 포함)는 버린다 —
// 220k × 200턴 셀에서 로그를 모으면 메모리가 파산한다.
export async function replayContextRotationCell(
  scenario: ContextRotationScenario,
  policyFactories: readonly ContextRotationPolicyFactory[],
): Promise<ContextRotationRunSummary[]> {
  const summaries: ContextRotationRunSummary[] = [];
  for (const policyFactory of policyFactories) {
    pluginStorage.clear();
    stubPluginStorage();
    const result = await replayScenario({
      cacheHitSimulator: createCacheHitSimulator('calibrated'),
      policy: policyFactory.create(scenario),
      scenario,
    });
    assertReplayInvariants(result);
    summaries.push(summarizeContextRotationReplay(scenario, result));
  }
  return summaries;
}
