export const MODEL_ARGUMENT = 'model';
export const SERVICE_TIER_ARGUMENT = 'service_tier';

// llmgateway.io의 GPT-5.6 시리즈 모델 ID.
export const MODEL_OPTIONS: readonly string[] = ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'];
export const DEFAULT_MODEL = 'gpt-5.6-sol';

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
