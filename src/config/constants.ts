export const API_KEY_ARGUMENT = 'api_key';
export const MODEL_ARGUMENT = 'model';
export const PROMPT_CACHE_MODE_ARGUMENT = 'prompt_cache_mode';
export const SERVICE_TIER_ARGUMENT = 'service_tier';
export const REASONING_EFFORT_ARGUMENT = 'reasoning_effort';
export const VERBOSITY_ARGUMENT = 'verbosity';
export const STREAMING_MODE_ARGUMENT = 'streaming_mode';
export const FLAGS_ARGUMENT = 'flags';

// pluginStorage는 전 플러그인 공용 네임스페이스라 접두사가 필수다.
export const CONFIG_STORAGE_KEY = 'llm-gateway-provider:config';
export const LEGACY_ARGUMENT_BACKUP_STORAGE_KEY =
  'llm-gateway-provider:arguments-backup';

export type ConfigFieldName =
  | typeof API_KEY_ARGUMENT
  | typeof MODEL_ARGUMENT
  | typeof PROMPT_CACHE_MODE_ARGUMENT
  | typeof SERVICE_TIER_ARGUMENT
  | typeof REASONING_EFFORT_ARGUMENT
  | typeof VERBOSITY_ARGUMENT
  | typeof STREAMING_MODE_ARGUMENT
  | typeof FLAGS_ARGUMENT;

export const CONFIG_FIELD_NAMES: readonly ConfigFieldName[] = [
  API_KEY_ARGUMENT,
  MODEL_ARGUMENT,
  PROMPT_CACHE_MODE_ARGUMENT,
  SERVICE_TIER_ARGUMENT,
  REASONING_EFFORT_ARGUMENT,
  VERBOSITY_ARGUMENT,
  STREAMING_MODE_ARGUMENT,
  FLAGS_ARGUMENT,
];
