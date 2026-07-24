import type { LlmMessage } from 'llm-io';

export interface ScenarioRequest {
  elapsedMinutes: number;
  messages: readonly LlmMessage[];
}

export interface SimulationScenario {
  id: string;
  label: string;
  requests: readonly ScenarioRequest[];
}
