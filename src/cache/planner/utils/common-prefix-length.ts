import type { MessageFingerprint } from '../../state/schema';
import { fingerprintsEqual } from './fingerprints-equal';

export function commonPrefixLength(
  previous: readonly MessageFingerprint[],
  current: readonly MessageFingerprint[],
): number {
  const maxLength = Math.min(previous.length, current.length);
  let length = 0;
  while (length < maxLength && fingerprintsEqual(previous[length], current[length])) {
    length += 1;
  }
  return length;
}
