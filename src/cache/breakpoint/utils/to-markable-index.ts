import type { LlmMessage } from 'llm-io';
import { isTextPart } from '../../utils/is-text-part';
import { MARKABLE_ROLES } from '../constants';

export function toMarkableIndex(messages: readonly LlmMessage[], index: number): number | null {
  for (let i = index; i >= 0; i -= 1) {
    if (MARKABLE_ROLES.has(messages[i].role) && messages[i].content.some(isTextPart)) {
      return i;
    }
  }
  return null;
}
