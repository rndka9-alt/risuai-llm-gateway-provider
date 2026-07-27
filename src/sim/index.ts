export {
  CacheHitSimulator,
  createCacheHitSimulator,
  type CacheHitSimulationRequest,
  type CacheHitSimulationResult,
  type CacheHitSimulatorOptions,
  type CacheHitSimulatorPreset,
  type CacheHitSimulatorTokenizer,
  type CacheWindowScope,
  type MarkerMatchMode,
} from './cache-backend/cache-hit-simulator';
export {
  type CacheCostModel,
  type CachePolicyDecision,
  type ReplayCachePolicy,
  type ReplayCachePolicyFactory,
  type ReplayPolicyContext,
  type ScenarioRequest,
  type SimulationScenario,
} from './contracts';
export {
  replayScenario,
  type ReplayRequestLog,
  type ReplayResult,
  type ReplayScenarioOptions,
} from './replay/replay';
export {
  simulate,
  type SimulationConfig,
  type SimulationReplayContext,
  type SimulationReport,
} from './sim';
