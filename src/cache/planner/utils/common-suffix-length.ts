import type { MessageFingerprint } from '../../state/schema';
import { fingerprintsEqual } from './fingerprints-equal';

export function commonSuffixLength(
  previous: readonly MessageFingerprint[],
  current: readonly MessageFingerprint[],
  prefixLength: number,
): number {
  const maxLength = Math.min(previous.length, current.length) - prefixLength;
  let length = 0;
  while (
    length < maxLength &&
    fingerprintsEqual(previous[previous.length - 1 - length], current[current.length - 1 - length])
  ) {
    length += 1;
  }
  return length;
}
