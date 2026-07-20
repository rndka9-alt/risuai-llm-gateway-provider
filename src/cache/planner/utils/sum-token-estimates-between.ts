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

/** 16K 신규-write admission guard용 합산. 이미지 토큰은 의도적으로 제외한다 —
 *  이미지 추정은 크기 미상 시 0으로 떨어지는 등 불확실성이 커서(fingerprint-message 참고),
 *  guard 판정은 텍스트 하한 기준으로만 동작시킨다. 이미지가 큰 프리픽스는 실제 write가
 *  16K를 넘어도 즉시 admission될 수 있음을 감수한 트레이드오프다. */
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
