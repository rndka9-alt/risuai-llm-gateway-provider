import {
  createCacheHitSimulator,
  type CacheHitSimulatorPreset,
} from './cache-backend/cache-hit-simulator';
import type { CacheCostModel, ReplayCachePolicyFactory, SimulationScenario } from './contracts';
import { replayScenario, type ReplayResult } from './replay/replay';

export interface SimulationReplayContext {
  cacheHitSimulatorPreset: CacheHitSimulatorPreset;
  policyName: string;
  scenarioId: string;
}

export interface SimulationConfig {
  cacheHitSimulatorPresets: readonly CacheHitSimulatorPreset[];
  costModel: CacheCostModel;
  policyFactories: readonly ReplayCachePolicyFactory[];
  prepareReplay: (context: SimulationReplayContext) => Promise<void> | void;
  scenarios: readonly SimulationScenario[];
}

export interface SimulationReport {
  costModel: CacheCostModel;
  results: readonly ReplayResult[];
}

function requireNonEmpty(name: string, values: readonly unknown[]): void {
  if (values.length === 0) {
    throw new RangeError(`Simulation config ${name} must not be empty.`);
  }
}

export async function simulate(config: SimulationConfig): Promise<SimulationReport> {
  requireNonEmpty('scenarios', config.scenarios);
  requireNonEmpty('cacheHitSimulatorPresets', config.cacheHitSimulatorPresets);
  requireNonEmpty('policyFactories', config.policyFactories);

  const results: ReplayResult[] = [];
  for (const scenario of config.scenarios) {
    for (const cacheHitSimulatorPreset of config.cacheHitSimulatorPresets) {
      for (const createPolicy of config.policyFactories) {
        const policy = createPolicy();
        await config.prepareReplay({
          cacheHitSimulatorPreset,
          policyName: policy.name,
          scenarioId: scenario.id,
        });
        results.push(
          await replayScenario({
            cacheHitSimulator: createCacheHitSimulator(cacheHitSimulatorPreset),
            costModel: config.costModel,
            policy,
            scenario,
          }),
        );
      }
    }
  }

  return { costModel: config.costModel, results };
}
