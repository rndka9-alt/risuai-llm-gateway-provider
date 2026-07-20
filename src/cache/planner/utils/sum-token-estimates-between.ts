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
 *  guard의 목적은 '금방 죽을 대형 write'의 오판 비용 제한인데, 이미지 블록은 재사용 간
 *  변동 가능성이 낮아 그 위험이 작고, 추정도 크기 미상 시 0이 되는 등 불확실하다
 *  (fingerprint-message 참고). 그래서 판정은 텍스트 하한 기준으로만 동작시키고,
 *  이미지가 큰 프리픽스가 즉시 admission될 수 있음은 감수한다.
 *  (1024 최소 프리픽스와 앵커 pruning 간격 계산에는 이미지 추정이 포함된다) */
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
