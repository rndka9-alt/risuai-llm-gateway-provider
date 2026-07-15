import type { OpenAIChatCompletionsExtraBody } from 'llm-io';

export const MODEL_ARGUMENT = 'model';
export const REASONING_EFFORT_ARGUMENT = 'reasoning_effort';
export const SERVICE_TIER_ARGUMENT = 'service_tier';
export const STREAMING_MODE_ARGUMENT = 'streaming_mode';
export const FLAGS_ARGUMENT = 'flags';
export const VERBOSITY_ARGUMENT = 'verbosity';

// llmgateway.io의 GPT-5.6 시리즈 모델 ID.
export const MODEL_OPTIONS: readonly string[] = ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'];
export const DEFAULT_MODEL = 'gpt-5.6-sol';

export type ReasoningEffort = Exclude<
  OpenAIChatCompletionsExtraBody['reasoning_effort'],
  undefined
>;
export type Verbosity = Exclude<OpenAIChatCompletionsExtraBody['verbosity'], undefined>;
export type StreamingMode = 'off' | 'decoupled' | 'stream';

export const REASONING_EFFORT_OPTIONS: readonly ReasoningEffort[] = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
];
export const VERBOSITY_OPTIONS: readonly Verbosity[] = ['low', 'medium', 'high'];

// RisuAI src/ts/model/types.ts의 LLMFlags(2026-07-16)를 그대로 옮긴 값이다.
// 플러그인 API는 flag 이름이 아니라 이 숫자 값을 요구하므로 본체 변경 시 함께 동기화해야 한다.
export const RISUAI_LLM_FLAGS = {
  hasImageInput: 0,
  hasImageOutput: 1,
  hasAudioInput: 2,
  hasAudioOutput: 3,
  hasPrefill: 4,
  hasCache: 5,
  hasFullSystemPrompt: 6,
  hasFirstSystemPrompt: 7,
  hasStreaming: 8,
  requiresAlternateRole: 9,
  mustStartWithUserInput: 10,
  poolSupported: 11,
  hasVideoInput: 12,
  OAICompletionTokens: 13,
  DeveloperRole: 14,
  geminiThinking: 15,
  geminiBlockOff: 16,
  deepSeekPrefix: 17,
  deepSeekThinkingInput: 18,
  deepSeekThinkingOutput: 19,
  noCivilIntegrity: 20,
  claudeThinking: 21,
  claudeAdaptiveThinking: 22,
  claudeXHighEffort: 23,
  deepSeekThinkingToggle: 24,
  noStructuredOutput: 25,
};

export type ConfigurableLlmFlagName =
  | 'hasFullSystemPrompt'
  | 'hasFirstSystemPrompt'
  | 'requiresAlternateRole'
  | 'mustStartWithUserInput'
  | 'poolSupported';

export const CONFIGURABLE_LLM_FLAG_NAMES: readonly ConfigurableLlmFlagName[] = [
  'hasFullSystemPrompt',
  'hasFirstSystemPrompt',
  'requiresAlternateRole',
  'mustStartWithUserInput',
  'poolSupported',
];

export type UnsupportedMediaLlmFlagName =
  | 'hasImageInput'
  | 'hasImageOutput'
  | 'hasAudioInput'
  | 'hasAudioOutput'
  | 'hasVideoInput';

export const UNSUPPORTED_MEDIA_LLM_FLAG_NAMES: readonly UnsupportedMediaLlmFlagName[] = [
  'hasImageInput',
  'hasImageOutput',
  'hasAudioInput',
  'hasAudioOutput',
  'hasVideoInput',
];

export const DEFAULT_CONFIGURABLE_LLM_FLAG_NAMES: readonly ConfigurableLlmFlagName[] = [
  'hasFullSystemPrompt',
];

function isConfigurableLlmFlagName(value: string): value is ConfigurableLlmFlagName {
  return CONFIGURABLE_LLM_FLAG_NAMES.some((flagName) => flagName === value);
}

export function resolveReasoningEffort(value: string | undefined): ReasoningEffort | undefined {
  const trimmed = value?.trim();
  if (trimmed === 'none') return 'none';
  if (trimmed === 'minimal') return 'minimal';
  if (trimmed === 'low') return 'low';
  if (trimmed === 'medium') return 'medium';
  if (trimmed === 'high') return 'high';
  if (trimmed === 'xhigh') return 'xhigh';
  if (trimmed === 'max') return 'max';
  return undefined;
}

export function resolveVerbosity(value: string | undefined): Verbosity | undefined {
  const trimmed = value?.trim();
  if (trimmed === 'low') return 'low';
  if (trimmed === 'medium') return 'medium';
  if (trimmed === 'high') return 'high';
  return undefined;
}

export function resolveStreamingMode(value: string | undefined): StreamingMode {
  const trimmed = value?.trim();
  if (trimmed === 'decoupled') return 'decoupled';
  if (trimmed === 'stream') return 'stream';
  return 'off';
}

export function resolveConfigurableLlmFlagNames(
  value: string | undefined,
): readonly ConfigurableLlmFlagName[] {
  if (value === undefined || value.trim() === '') return DEFAULT_CONFIGURABLE_LLM_FLAG_NAMES;

  return [...new Set(
    value
      .split(',')
      .map((flagName) => flagName.trim())
      .filter(isConfigurableLlmFlagName),
  )];
}

export function serializeConfigurableLlmFlagNames(
  flagNames: readonly ConfigurableLlmFlagName[],
): string {
  return flagNames.join(',');
}

export function resolveProviderLlmFlags(
  flagNames: readonly ConfigurableLlmFlagName[],
  streamingMode: StreamingMode,
): number[] {
  const flags: number[] = flagNames.map((flagName) => RISUAI_LLM_FLAGS[flagName]);
  if (streamingMode !== 'off') flags.push(RISUAI_LLM_FLAGS.hasStreaming);
  return flags;
}

// llm-io OpenAIChatCompletionsServiceTier 중 이 플러그인이 노출하는 부분집합.
export type ServiceTier = 'default' | 'flex';

// 미지정·알 수 없는 값이면 undefined를 반환해 body에서 service_tier를 생략한다
// (생략 시 provider 기본 동작 auto를 따른다).
export function resolveServiceTier(value: string | undefined): ServiceTier | undefined {
  const trimmed = value?.trim();
  if (trimmed === 'flex') return 'flex';
  if (trimmed === 'default') return 'default';
  return undefined;
}
