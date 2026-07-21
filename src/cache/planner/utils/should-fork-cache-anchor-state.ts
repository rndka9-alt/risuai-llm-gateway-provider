import type { CacheAnchorState, MessageFingerprint } from '../../state/schema';
import { isShiftedPrefixChange } from './is-shifted-prefix-change';

// frontier가 공통 프리픽스 밖으로 죽은 전이는 원본 그룹의 후속 요청이라고
// 단정할 수 없다. planner가 리롤로 보는 같은 길이 비시프트 교체는 제자리
// 갱신하고, 분기·축소·frontier 앞 삽입·트림 시프트는 새 그룹으로 갈라
// 원본을 보존한다.
export function shouldForkCacheAnchorState(
  previousState: CacheAnchorState,
  currentFingerprints: readonly MessageFingerprint[],
  prefixLength: number,
): boolean {
  const previousFrontierIndex = previousState.anchorIndexes.at(-1);
  if (previousFrontierIndex === undefined || prefixLength > previousFrontierIndex) return false;

  const sameLength = previousState.fingerprints.length === currentFingerprints.length;
  const rerollLikeChange =
    sameLength &&
    !isShiftedPrefixChange(previousState.fingerprints, currentFingerprints, prefixLength);
  return !rerollLikeChange;
}
