import { describe, expect, it, vi } from 'vitest';
import { createCacheHitSimulator } from '../../cache-hit-simulators';
import { replayScenario } from '../../replay';
import {
  createContextRotationCell,
  createContextRotationScenario,
} from './context-rotation-scenarios';
import { summarizeContextRotationReplay } from './context-rotation-metrics';
import {
  FULL_POLICY_FACTORIES,
  assertReplayInvariants,
  pluginStorage,
  stubPluginStorage,
} from './context-rotation-harness';

// 전체 격자를 걸기 전에 최대 셀(220k × 200턴)의 실행 시간·메모리를 단독 실측한다.
// 이 수치로 전체 예산을 확정한다 — 파일럿 없이 전체를 걸지 않는다.
//   CONTEXT_ROTATION=pilot npx vitest run src/__tests__/sim/experiments/context-rotation/context-rotation-pilot.test.ts

const PILOT_POLICY_NAMES = ['no-cache', 'production', 'oracle-surviving-frontier'] as const;

describe.runIf(['full', 'pilot'].includes(process.env.CONTEXT_ROTATION ?? ''))(
  'context-rotation 파일럿',
  () => {
    it('최대 셀의 실행 비용을 실측한다', async () => {
      const scenario = createContextRotationScenario(
        createContextRotationCell({
          arm: 'core',
          extraSummarizationRatio: 0.5,
          maxContextTokens: 220_000,
          memoryMode: 'hypa',
        }),
      );
      console.log(
        `[pilot] ${scenario.id}: ${scenario.requests.length}요청, k=${scenario.quietTurnCapacity}, ` +
          `발동 ${scenario.firingRequestIndexes.length}회`,
      );

      const pilotPolicyFactories = FULL_POLICY_FACTORIES.filter((factory) =>
        (PILOT_POLICY_NAMES as readonly string[]).includes(factory.name),
      );
      expect(pilotPolicyFactories).toHaveLength(PILOT_POLICY_NAMES.length);

      for (const policyFactory of pilotPolicyFactories) {
        pluginStorage.clear();
        stubPluginStorage();
        const heapUsedBefore = process.memoryUsage().heapUsed;
        const startedAt = performance.now();
        const result = await replayScenario({
          cacheHitSimulator: createCacheHitSimulator('calibrated'),
          policy: policyFactory.create(scenario),
          scenario,
        });
        const durationMs = performance.now() - startedAt;
        const memoryAfter = process.memoryUsage();
        assertReplayInvariants(result);
        const summary = summarizeContextRotationReplay(scenario, result);
        console.log(
          `[pilot] ${policyFactory.name}: ${(durationMs / 1_000).toFixed(1)}s, ` +
            `heapUsed ${(memoryAfter.heapUsed / 1_048_576).toFixed(0)}MB ` +
            `(Δ${((memoryAfter.heapUsed - heapUsedBefore) / 1_048_576).toFixed(0)}MB), ` +
            `rss ${(memoryAfter.rss / 1_048_576).toFixed(0)}MB, ` +
            `eff ${summary.steadyEfficiencyPercent.toFixed(1)}%, ` +
            `read ${summary.readSharePercent.toFixed(1)}%, write ${summary.writeSharePercent.toFixed(1)}%`,
        );
        expect(summary.steadyRequestCount).toBeGreaterThan(0);
      }
      vi.unstubAllGlobals();
    }, 1_800_000);
  },
);
