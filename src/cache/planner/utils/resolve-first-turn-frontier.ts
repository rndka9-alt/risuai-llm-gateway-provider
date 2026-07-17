import type { MessageFingerprint } from '../../state/schema';

// 첫 요청(또는 새 epoch)은 diff 대상이 없으므로, 유저 입력이 대체로 마지막
// user 롤 메시지로 들어온다는 가정 하에 그 직전을 안정 프리픽스의 끝으로 추정한다.
export function resolveFirstTurnFrontier(fingerprints: readonly MessageFingerprint[]): number | null {
  for (let i = fingerprints.length - 1; i >= 0; i -= 1) {
    if (fingerprints[i].role === 'user') {
      return i > 0 ? i - 1 : null;
    }
  }
  return null;
}
