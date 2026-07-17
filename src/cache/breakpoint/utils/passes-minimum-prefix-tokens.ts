import { MIN_CACHEABLE_PREFIX_TOKENS } from '../../constants';
import type { MessageFingerprint } from '../../state/schema';

export function passesMinimumPrefixTokens(
  fingerprints: readonly MessageFingerprint[],
  index: number,
): boolean {
  let total = 0;
  for (let i = 0; i <= index; i += 1) {
    total += fingerprints[i].tokenEstimate;
  }
  return total >= MIN_CACHEABLE_PREFIX_TOKENS;
}
