import type { LlmContentPart, LlmImagePart } from 'llm-io';

export function isImagePart(part: LlmContentPart): part is LlmImagePart {
  return part.type === 'image';
}
