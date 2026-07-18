import type { MessageFingerprint } from '../../state/schema';

// 같은 메시지 수의 변경을 두 부류로 가른다.
// - 제자리 교체(리롤·in-place 수정·churn): 분기점의 현재 메시지가 새 내용이라
//   직전 요청 어디에도 없다 → 이벤트당 손실이 유계라 스트라이크 대상이 아니다.
// - 시프트(트림 포화: 앞이 잘리고 뒤가 붙어 개수 유지): 분기점의 현재 메시지가
//   직전 요청의 더 뒤 인덱스에 그대로 있다 → 매턴 반복되는 구조적 사망이라
//   스트라이크로 센다.
// fingerprint 해시는 이미 상태에 저장돼 있어 추가 비용이 없다.
export function isShiftedPrefixChange(
  previous: readonly MessageFingerprint[],
  current: readonly MessageFingerprint[],
  prefixLength: number,
): boolean {
  const divergent = current[prefixLength];
  if (divergent === undefined) return false;

  for (let index = prefixLength + 1; index < previous.length; index += 1) {
    if (previous[index].hash === divergent.hash && previous[index].role === divergent.role) {
      return true;
    }
  }
  return false;
}
