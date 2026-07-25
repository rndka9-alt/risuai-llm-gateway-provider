// llmgateway.io의 GPT-5.6 시리즈 모델 ID.
export const MODEL_OPTIONS: readonly string[] = ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'];
export const DEFAULT_MODEL = 'gpt-5.6-sol';

// 상태바는 플러그인이 GPT-5.6 전용임을 전제로 시리즈 접미만 짧게 보여준다.
// 목록에 없는 커스텀 모델 ID는 원문을 그대로 노출한다.
const MODEL_DISPLAY_LABELS: Record<string, string> = {
  'gpt-5.6-sol': 'Sol',
  'gpt-5.6-terra': 'Terra',
  'gpt-5.6-luna': 'Luna',
};

export function resolveModelDisplayLabel(model: string): string {
  return MODEL_DISPLAY_LABELS[model] ?? model;
}
