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

// RisuAI src/ts/model/types.ts의 LLMTokenizer.tiktokenO200Base 값이다.
// V3 모델은 top-level tokenizer 문자열이 아니라 model metadata의 숫자 값을 사용한다.
export const RISUAI_TIKTOKEN_O200_BASE_TOKENIZER = 2;

export type ConfigurableLlmFlagName =
  | 'hasFullSystemPrompt'
  | 'hasFirstSystemPrompt'
  | 'requiresAlternateRole'
  | 'mustStartWithUserInput'
  | 'poolSupported'
  | 'hasImageInput';

export const CONFIGURABLE_LLM_FLAG_NAMES: readonly ConfigurableLlmFlagName[] = [
  'hasFullSystemPrompt',
  'hasFirstSystemPrompt',
  'requiresAlternateRole',
  'mustStartWithUserInput',
  'poolSupported',
  'hasImageInput',
];

export const DEFAULT_CONFIGURABLE_LLM_FLAG_NAMES: readonly ConfigurableLlmFlagName[] = [
  'hasFullSystemPrompt',
];

const EMPTY_CONFIGURABLE_LLM_FLAGS_SENTINEL = 'none';

function isConfigurableLlmFlagName(value: string): value is ConfigurableLlmFlagName {
  return CONFIGURABLE_LLM_FLAG_NAMES.some((flagName) => flagName === value);
}

export function resolveConfigurableLlmFlagNames(
  value: string | undefined,
): readonly ConfigurableLlmFlagName[] {
  // 빈 문자열은 미설정 기본값을 뜻하는 기존 시맨틱이므로, 명시적인 빈 선택은
  // 별도 sentinel로 구분해 모든 체크 해제 상태를 복원한다.
  if (value === undefined || value.trim() === '') return DEFAULT_CONFIGURABLE_LLM_FLAG_NAMES;
  if (value.trim() === EMPTY_CONFIGURABLE_LLM_FLAGS_SENTINEL) return [];

  return [
    ...new Set(
      value
        .split(',')
        .map((flagName) => flagName.trim())
        .filter(isConfigurableLlmFlagName),
    ),
  ];
}

export function serializeConfigurableLlmFlagNames(
  flagNames: readonly ConfigurableLlmFlagName[],
): string {
  return flagNames.length === 0 ? EMPTY_CONFIGURABLE_LLM_FLAGS_SENTINEL : flagNames.join(',');
}

export function resolveProviderLlmFlags(flagNames: readonly ConfigurableLlmFlagName[]): number[] {
  // decoupled도 RisuAI에는 완성 문자열을 반환하므로 hasStreaming 선언은 거짓이 된다.
  return flagNames.map((flagName) => RISUAI_LLM_FLAGS[flagName]);
}
