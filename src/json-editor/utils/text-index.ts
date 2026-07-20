import type { TextPosition, TextRange } from '../types';

/** 한 번 만든 인덱스로 offset → line/column 변환을 반복 수행한다 */
export interface TextIndex {
  positionAt(offset: number): TextPosition;
  rangeAt(offset: number, length: number): TextRange;
}

export function createTextIndex(text: string): TextIndex {
  const lineStartOffsets = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\n') lineStartOffsets.push(index + 1);
  }

  function positionAt(offset: number): TextPosition {
    const clampedOffset = Math.max(0, Math.min(offset, text.length));
    let low = 0;
    let high = lineStartOffsets.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (lineStartOffsets[middle] <= clampedOffset) low = middle;
      else high = middle - 1;
    }
    return {
      offset: clampedOffset,
      line: low + 1,
      column: clampedOffset - lineStartOffsets[low] + 1,
    };
  }

  return {
    positionAt,
    rangeAt(offset, length) {
      return { start: positionAt(offset), end: positionAt(offset + length) };
    },
  };
}
