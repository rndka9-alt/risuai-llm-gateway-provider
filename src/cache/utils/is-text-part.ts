import type { LlmContentPart, LlmTextPart } from 'llm-io';

export function isTextPart(part: LlmContentPart): part is LlmTextPart {
  return part.type === 'text';
}
