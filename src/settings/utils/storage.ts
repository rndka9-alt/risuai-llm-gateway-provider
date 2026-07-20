import { resolvePromptCacheMode, type PromptCacheMode } from '../../cache';
import {
  API_KEY_ARGUMENT,
  EXTRA_BODY_ARGUMENT,
  FLAGS_ARGUMENT,
  MODEL_ARGUMENT,
  PROMPT_CACHE_MODE_ARGUMENT,
  REASONING_EFFORT_ARGUMENT,
  SERVICE_TIER_ARGUMENT,
  STREAMING_MODE_ARGUMENT,
  VERBOSITY_ARGUMENT,
  loadConfig,
  saveConfig,
} from '../../config';
import {
  DEFAULT_MODEL,
  resolveConfigurableLlmFlagNames,
  resolveReasoningEffort,
  resolveServiceTier,
  resolveStreamingMode,
  resolveVerbosity,
  serializeConfigurableLlmFlagNames,
  type ConfigurableLlmFlagName,
  type ReasoningEffort,
  type ServiceTier,
  type StreamingMode,
  type Verbosity,
} from '../../options';

export async function loadApiKey(): Promise<string> {
  return (await loadConfig())[API_KEY_ARGUMENT];
}

export async function saveApiKey(value: string): Promise<void> {
  await saveConfig({ [API_KEY_ARGUMENT]: value });
}

export async function loadPromptCacheMode(): Promise<PromptCacheMode> {
  const config = await loadConfig();
  return resolvePromptCacheMode(config[PROMPT_CACHE_MODE_ARGUMENT]);
}

export async function savePromptCacheMode(value: PromptCacheMode): Promise<void> {
  await saveConfig({ [PROMPT_CACHE_MODE_ARGUMENT]: value });
}

export async function loadModel(): Promise<string> {
  const value = (await loadConfig())[MODEL_ARGUMENT];
  const trimmed = value.trim();
  return trimmed === '' ? DEFAULT_MODEL : trimmed;
}

export async function saveModel(value: string): Promise<void> {
  await saveConfig({ [MODEL_ARGUMENT]: value });
}

export async function loadServiceTier(): Promise<ServiceTier | undefined> {
  const config = await loadConfig();
  return resolveServiceTier(config[SERVICE_TIER_ARGUMENT]);
}

export async function saveServiceTier(value: ServiceTier | undefined): Promise<void> {
  await saveConfig({
    // 끔은 ''로 저장한다 — 생략이 조직 기본 티어를 살리는 배포된 의미 (resolveServiceTier 참고).
    [SERVICE_TIER_ARGUMENT]: value === 'flex' ? 'flex' : '',
  });
}

export async function loadReasoningEffort(): Promise<ReasoningEffort | undefined> {
  const config = await loadConfig();
  return resolveReasoningEffort(config[REASONING_EFFORT_ARGUMENT]);
}

export async function saveReasoningEffort(value: ReasoningEffort | undefined): Promise<void> {
  await saveConfig({ [REASONING_EFFORT_ARGUMENT]: value ?? '' });
}

export async function loadVerbosity(): Promise<Verbosity | undefined> {
  const config = await loadConfig();
  return resolveVerbosity(config[VERBOSITY_ARGUMENT]);
}

export async function saveVerbosity(value: Verbosity | undefined): Promise<void> {
  await saveConfig({ [VERBOSITY_ARGUMENT]: value ?? '' });
}

export async function loadStreamingMode(): Promise<StreamingMode> {
  const config = await loadConfig();
  return resolveStreamingMode(config[STREAMING_MODE_ARGUMENT]);
}

export async function saveStreamingMode(value: StreamingMode): Promise<void> {
  await saveConfig({ [STREAMING_MODE_ARGUMENT]: value });
}

export async function loadConfigurableLlmFlagNames(): Promise<readonly ConfigurableLlmFlagName[]> {
  const config = await loadConfig();
  return resolveConfigurableLlmFlagNames(config[FLAGS_ARGUMENT]);
}

export async function saveConfigurableLlmFlagNames(
  flagNames: readonly ConfigurableLlmFlagName[],
): Promise<void> {
  await saveConfig({
    [FLAGS_ARGUMENT]: serializeConfigurableLlmFlagNames(flagNames),
  });
}

export async function loadExtraBody(): Promise<string> {
  return (await loadConfig())[EXTRA_BODY_ARGUMENT];
}

export async function saveExtraBody(value: string): Promise<void> {
  await saveConfig({ [EXTRA_BODY_ARGUMENT]: value });
}

export interface SettingsValues {
  apiKey: string;
  extraBody: string;
  flagNames: readonly ConfigurableLlmFlagName[];
  model: string;
  promptCacheMode: PromptCacheMode;
  reasoningEffort: ReasoningEffort | undefined;
  serviceTier: ServiceTier | undefined;
  streamingMode: StreamingMode;
  verbosity: Verbosity | undefined;
}

export async function saveSettings(values: SettingsValues): Promise<void> {
  await saveConfig({
    [API_KEY_ARGUMENT]: values.apiKey,
    [EXTRA_BODY_ARGUMENT]: values.extraBody,
    [MODEL_ARGUMENT]: values.model,
    [PROMPT_CACHE_MODE_ARGUMENT]: values.promptCacheMode,
    [SERVICE_TIER_ARGUMENT]: values.serviceTier === 'flex' ? 'flex' : '',
    [REASONING_EFFORT_ARGUMENT]: values.reasoningEffort ?? '',
    [VERBOSITY_ARGUMENT]: values.verbosity ?? '',
    [STREAMING_MODE_ARGUMENT]: values.streamingMode,
    [FLAGS_ARGUMENT]: serializeConfigurableLlmFlagNames(values.flagNames),
  });
}
