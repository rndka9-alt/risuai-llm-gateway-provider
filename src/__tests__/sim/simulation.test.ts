import { describe, expect, it } from 'vitest';
import type { LlmMessage } from 'llm-io';
import {
  simulate,
  type ReplayCachePolicyFactory,
  type SimulationReplayContext,
  type SimulationScenario,
} from '../../sim';

const scenario: SimulationScenario = {
  id: 'headless-smoke',
  label: 'headless simulation smoke',
  requests: [
    {
      elapsedMinutes: 0,
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'Headless simulation input.' }],
        },
      ],
    },
  ],
};

function createPolicyFactory(name: string): ReplayCachePolicyFactory {
  return () => ({
    name,
    async apply(messages: readonly LlmMessage[]) {
      return {
        anchorIndexes: [],
        consecutiveEpochResets: 0,
        messages,
        promptCacheKey: `headless-${name}`,
      };
    },
  });
}

describe('headless simulation', () => {
  it('scenario × backend × policy matrix를 구조화된 report로 반환한다', async () => {
    const preparedContexts: SimulationReplayContext[] = [];
    const costModel = {
      readTokenSavingsRate: 0.9,
      writeTokenPremiumRate: 0.25,
    };

    const report = await simulate({
      cacheHitSimulatorPresets: ['calibrated', 'pessimistic'],
      costModel,
      policyFactories: [createPolicyFactory('first'), createPolicyFactory('second')],
      prepareReplay(context) {
        preparedContexts.push(context);
      },
      scenarios: [scenario],
    });

    expect(report.costModel).toBe(costModel);
    expect(
      report.results.map((result) => [result.cacheHitSimulatorName, result.policyName]),
    ).toEqual([
      ['calibrated', 'first'],
      ['calibrated', 'second'],
      ['pessimistic', 'first'],
      ['pessimistic', 'second'],
    ]);
    expect(preparedContexts).toEqual([
      {
        cacheHitSimulatorPreset: 'calibrated',
        policyName: 'first',
        scenarioId: 'headless-smoke',
      },
      {
        cacheHitSimulatorPreset: 'calibrated',
        policyName: 'second',
        scenarioId: 'headless-smoke',
      },
      {
        cacheHitSimulatorPreset: 'pessimistic',
        policyName: 'first',
        scenarioId: 'headless-smoke',
      },
      {
        cacheHitSimulatorPreset: 'pessimistic',
        policyName: 'second',
        scenarioId: 'headless-smoke',
      },
    ]);
  });

  it('빈 실행 축은 묵음 성공시키지 않는다', async () => {
    await expect(
      simulate({
        cacheHitSimulatorPresets: ['calibrated'],
        costModel: {
          readTokenSavingsRate: 0.9,
          writeTokenPremiumRate: 0.25,
        },
        policyFactories: [],
        prepareReplay() {},
        scenarios: [scenario],
      }),
    ).rejects.toThrow('Simulation config policyFactories must not be empty.');
  });
});
