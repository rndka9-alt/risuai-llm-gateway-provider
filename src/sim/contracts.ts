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

export interface CacheCostModel {
  readTokenSavingsRate: number;
  writeTokenPremiumRate: number;
}

export interface CachePolicyDecision {
  anchorIndexes: readonly number[];
  consecutiveEpochResets: number;
  messages: readonly LlmMessage[];
  promptCacheKey: string;
}

export interface ReplayPolicyContext {
  atMinute: number;
}

export interface ReplayCachePolicy {
  readonly name: string;
  apply(
    messages: readonly LlmMessage[],
    context?: ReplayPolicyContext,
  ): Promise<CachePolicyDecision>;
}

export type ReplayCachePolicyFactory = () => ReplayCachePolicy;
