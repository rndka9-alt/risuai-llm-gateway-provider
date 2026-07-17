import type { MessageFingerprint } from '../../state/schema';
import { evictClosestAnchors } from './evict-closest-anchors';

export function normalizeAnchorIndexes(
  candidates: readonly number[],
  fingerprints: readonly MessageFingerprint[],
): number[] {
  const sortedIndexes = [...new Set(candidates)].sort((left, right) => left - right);
  return evictClosestAnchors(sortedIndexes, fingerprints);
}
