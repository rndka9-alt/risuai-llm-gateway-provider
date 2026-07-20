import type { LlmImagePart, LlmMessage } from 'llm-io';
import type { MessageFingerprint } from '../state/schema';
import { isImagePart } from '../utils/is-image-part';
import { isTextPart } from '../utils/is-text-part';
import { estimateTokens } from './utils/estimate-tokens';
import { fnv1aHash } from './utils/fnv1a-hash';

export function fingerprintMessage(message: LlmMessage): MessageFingerprint {
  let text = '';
  let imageTokenEstimate = 0;
  for (const part of message.content) {
    if (isTextPart(part)) text += part.text;
    if (isImagePart(part)) imageTokenEstimate += estimateImageTokens(part);
  }
  const textTokenEstimate = estimateTokens(text) + 4;
  return {
    role: message.role,
    hash: fnv1aHash(`${message.role}\0${JSON.stringify(message.content)}`),
    tokenEstimate: textTokenEstimate + imageTokenEstimate,
    textTokenEstimate,
  };
}

function estimateImageTokens(imagePart: LlmImagePart): number {
  const width = imagePart.width;
  const height = imagePart.height;
  if (
    typeof width !== 'number' ||
    !Number.isFinite(width) ||
    width <= 0 ||
    typeof height !== 'number' ||
    !Number.isFinite(height) ||
    height <= 0
  ) {
    // 압축된 Base64 바이트 수로는 vision patch 수를 복원할 수 없다. 크기를 모르면
    // 과대 추정을 만들지 않고 텍스트 lower bound만으로 최소 prefix를 판정한다.
    return 0;
  }
  return Math.ceil(width / 32) * Math.ceil(height / 32);
}
