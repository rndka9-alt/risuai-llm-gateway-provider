import type { LlmMessage } from 'llm-io';
import type { MessageFingerprint } from '../state/schema';
import { isTextPart } from '../utils/is-text-part';
import { estimateTokens } from './utils/estimate-tokens';
import { fnv1aHash } from './utils/fnv1a-hash';

export function fingerprintMessage(message: LlmMessage): MessageFingerprint {
  let text = '';
  for (const part of message.content) {
    if (isTextPart(part)) text += part.text;
  }
  return {
    role: message.role,
    hash: fnv1aHash(`${message.role}\0${JSON.stringify(message.content)}`),
    tokenEstimate: estimateTokens(text) + 4,
  };
}
