import { CACHE_READ_SAVING_RATE, CACHE_WRITE_PREMIUM_RATE } from '../../../ledger';
import {
  replayScenario as replaySimulationScenario,
  type ReplayScenarioOptions,
} from 'llm-cache-simulator';

type ProjectReplayScenarioOptions = Omit<ReplayScenarioOptions, 'costModel'>;

export function replayScenario(options: ProjectReplayScenarioOptions) {
  return replaySimulationScenario({
    ...options,
    costModel: {
      readTokenSavingsRate: CACHE_READ_SAVING_RATE,
      writeTokenPremiumRate: CACHE_WRITE_PREMIUM_RATE,
    },
  });
}

export type { ReplayRequestLog, ReplayResult } from 'llm-cache-simulator';
