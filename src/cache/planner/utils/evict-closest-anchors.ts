import type { MessageFingerprint } from '../../state/schema';
import { sumTokenEstimatesBetween } from './sum-token-estimates-between';

export function evictClosestAnchors(
  anchorIndexes: readonly number[],
  fingerprints: readonly MessageFingerprint[],
): number[] {
  const retainedIndexes = [...anchorIndexes];
  while (retainedIndexes.length > 4) {
    let positionToRemove = -1;
    let closestPairTokenGap = Number.POSITIVE_INFINITY;
    for (let position = 0; position < retainedIndexes.length - 1; position += 1) {
      const rightPosition = position + 1;
      const removalCandidate =
        rightPosition === retainedIndexes.length - 1 ? position : rightPosition;
      // 정속 append에선 (직전 frontier, 새 frontier)가 항상 최근접 쌍이라 직전
      // frontier가 매턴 축출되고, exact-match 계약에서 직전 턴에 write한 엔트리가
      // 마커를 잃어 read 체인이 끊긴다 (60턴 append 실측 eff 21.2%). 마지막 두
      // 앵커(최신 frontier + 직전 frontier)를 보호해 write가 다음 턴에 회수되게 한다.
      if (removalCandidate >= retainedIndexes.length - 2) continue;
      const tokenGap = sumTokenEstimatesBetween(
        fingerprints,
        retainedIndexes[position],
        retainedIndexes[rightPosition],
      );
      if (tokenGap < closestPairTokenGap) {
        closestPairTokenGap = tokenGap;
        positionToRemove = removalCandidate;
      }
    }

    if (positionToRemove === -1) {
      throw new Error('Anchor eviction must find a removable position when over capacity.');
    }
    retainedIndexes.splice(positionToRemove, 1);
  }
  return retainedIndexes;
}
