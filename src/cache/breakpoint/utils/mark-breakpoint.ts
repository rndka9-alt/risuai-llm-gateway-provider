import type { LlmMessage } from 'llm-io';
import { isImagePart } from '../../utils/is-image-part';
import { isTextPart } from '../../utils/is-text-part';

export function markBreakpoint(message: LlmMessage): LlmMessage {
  let lastCacheablePartIndex = -1;
  message.content.forEach((part, index) => {
    if (isTextPart(part) || isImagePart(part)) lastCacheablePartIndex = index;
  });
  if (lastCacheablePartIndex === -1) return message;

  return {
    ...message,
    content: message.content.map((part, index) =>
      index === lastCacheablePartIndex && (isTextPart(part) || isImagePart(part))
        ? { ...part, cacheBreakpoint: { mode: 'explicit' } }
        : part,
    ),
  };
}
