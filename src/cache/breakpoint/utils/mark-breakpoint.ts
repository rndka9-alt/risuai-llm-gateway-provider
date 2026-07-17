import type { LlmMessage } from 'llm-io';
import { isTextPart } from '../../utils/is-text-part';

export function markBreakpoint(message: LlmMessage): LlmMessage {
  let lastTextPartIndex = -1;
  message.content.forEach((part, index) => {
    if (isTextPart(part)) lastTextPartIndex = index;
  });
  if (lastTextPartIndex === -1) return message;

  return {
    ...message,
    content: message.content.map((part, index) =>
      index === lastTextPartIndex && isTextPart(part)
        ? { ...part, cacheBreakpoint: { mode: 'explicit' } }
        : part,
    ),
  };
}
