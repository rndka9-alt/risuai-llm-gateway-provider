import type { MessageFingerprint } from '../../state/schema';

export function sumTokenEstimatesBetween(
  fingerprints: readonly MessageFingerprint[],
  leftAnchorIndex: number,
  rightAnchorIndex: number,
): number {
  let total = 0;
  for (let index = leftAnchorIndex + 1; index <= rightAnchorIndex; index += 1) {
    total += fingerprints[index].tokenEstimate;
  }
  return total;
}

export function sumTextTokenEstimatesBetween(
  fingerprints: readonly MessageFingerprint[],
  leftAnchorIndex: number,
  rightAnchorIndex: number,
): number {
  let total = 0;
  for (let index = leftAnchorIndex + 1; index <= rightAnchorIndex; index += 1) {
    // 저장된 v0.9 state는 전용 필드가 없으므로 종전 추정값을 안전하게 승계한다.
    total += fingerprints[index].textTokenEstimate ?? fingerprints[index].tokenEstimate;
  }
  return total;
}
