import type { OpenAIChatCompletionsExtraBody } from 'llm-io';

// llmgateway.io의 GPT-5.6 시리즈 모델 ID.
export const MODEL_OPTIONS: readonly string[] = ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'];
export const DEFAULT_MODEL = 'gpt-5.6-sol';

export type ReasoningEffort = Exclude<
  OpenAIChatCompletionsExtraBody['reasoning_effort'],
  undefined
>;
export type Verbosity = Exclude<OpenAIChatCompletionsExtraBody['verbosity'], undefined>;
export type StreamingMode = 'off' | 'decoupled';

// 실측(gpt-5.6-sol, llmgateway 경유): minimal만 400 unsupported_value로 거절되고
// max는 200으로 수락된다. minimal 거절 에러가 나열한 지원값 목록(none~xhigh)은
// 실제 검증기 동작과 불일치하므로 목록이 아닌 직접 실측을 근거로 삼는다.
export const REASONING_EFFORT_OPTIONS: readonly ReasoningEffort[] = [
  'none',
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

// RisuAI src/ts/model/types.ts의 LLMTokenizer.tiktokenO200Base 값이다.
// V3 모델은 top-level tokenizer 문자열이 아니라 model metadata의 숫자 값을 사용한다.
export const RISUAI_TIKTOKEN_O200_BASE_TOKENIZER = 2;

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
  'hasImageOutput' | 'hasAudioInput' | 'hasAudioOutput' | 'hasVideoInput';

export const UNSUPPORTED_MEDIA_LLM_FLAG_NAMES: readonly UnsupportedMediaLlmFlagName[] = [
  'hasImageOutput',
  'hasAudioInput',
  'hasAudioOutput',
  'hasVideoInput',
];

export const DEFAULT_CONFIGURABLE_LLM_FLAG_NAMES: readonly ConfigurableLlmFlagName[] = [
  'hasFullSystemPrompt',
];

const EMPTY_CONFIGURABLE_LLM_FLAGS_SENTINEL = 'none';

function isConfigurableLlmFlagName(value: string): value is ConfigurableLlmFlagName {
  return CONFIGURABLE_LLM_FLAG_NAMES.some((flagName) => flagName === value);
}

export function resolveReasoningEffort(value: string | undefined): ReasoningEffort | undefined {
  const trimmed = value?.trim();
  if (trimmed === 'none') return 'none';
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
  // iframe→본체 브릿지 factory.ts guest의 collectTransferables가 ReadableStream을 수집하지 않아
  // 기존 stream 저장값은 DataCloneError를 피할 수 있는 decoupled로 정규화한다.
  if (trimmed === 'stream') return 'decoupled';
  return 'off';
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
  // 이미지 입력은 설정과 무관한 provider 고정 capability다.
  return [
    RISUAI_LLM_FLAGS.hasImageInput,
    ...flagNames.map((flagName) => RISUAI_LLM_FLAGS[flagName]),
  ];
}

// 플러그인은 Flex 요청만 명시하고, 비활성 상태에서는 provider 기본값을 따른다.
export type ServiceTier = 'flex';

// 저장값 ''는 service_tier를 body에서 생략한다. 생략 시 DevPass 조직의
// `Default service tier` 대시보드 설정이 적용될 수 있고(Flex 지원 모델 한정),
// 명시적 'default' 전송은 이 조직 기본값을 덮어써 버려 구버전에서 생략으로 바꿨다.
// 미설정과 명시적 끔이 같은 ''라 해석 계층에서 기본값을 바꾸면 껐던 사용자가 뒤집힌다.
// 구버전 default 저장값을 포함해 Flex 외 값은 undefined로 정규화해 생략한다.
export function resolveServiceTier(value: string | undefined): ServiceTier | undefined {
  const trimmed = value?.trim();
  if (trimmed === 'flex') return 'flex';
  return undefined;
}
