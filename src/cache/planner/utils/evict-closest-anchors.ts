import type { MessageFingerprint } from '../../state/schema';
import { sumTokenEstimatesBetween } from './sum-token-estimates-between';

export function evictClosestAnchors(
  anchorIndexes: readonly number[],
  fingerprints: readonly MessageFingerprint[],
): number[] {
  const retainedIndexes = [...anchorIndexes];
  while (retainedIndexes.length > 4) {
    let closestPairStart = 0;
    let closestPairTokenGap = Number.POSITIVE_INFINITY;
    for (let position = 0; position < retainedIndexes.length - 1; position += 1) {
      const tokenGap = sumTokenEstimatesBetween(
        fingerprints,
        retainedIndexes[position],
        retainedIndexes[position + 1],
      );
      if (tokenGap < closestPairTokenGap) {
        closestPairStart = position;
        closestPairTokenGap = tokenGap;
      }
    }

    const rightPosition = closestPairStart + 1;
    const positionToRemove =
      rightPosition === retainedIndexes.length - 1 ? closestPairStart : rightPosition;
    retainedIndexes.splice(positionToRemove, 1);
  }
  return retainedIndexes;
}
