import type { OpenAIChatCompletionsExtraBody } from 'llm-io';

export type ReasoningEffort = Exclude<
  OpenAIChatCompletionsExtraBody['reasoning_effort'],
  undefined
>;

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
