import type { LlmMessage } from 'llm-io';
import type { CacheAnchorState } from '../state/schema';
import type { CachePlan } from '../types';
import { fingerprintMessage } from './fingerprint-message';
import { commonPrefixLength } from './utils/common-prefix-length';
import { commonSuffixLength } from './utils/common-suffix-length';
import { createFirstTurnPlan } from './utils/create-first-turn-plan';
import { normalizeAnchorIndexes } from './utils/normalize-anchor-indexes';

// ===== breakpoint 자동 배치 =====
// 조립된 messages만으로는 로어북/채팅 경계를 구조적으로 알 수 없으므로,
// 직전 요청과의 양끝 diff(공통 프리픽스 + 공통 서픽스, 메시지 단위)로
// "삽입 구간(채팅 성장 지점)"을 찾아 그 끝에 frontier breakpoint를 찍는다.
// 공통 서픽스(후행 블록)는 매턴 위치가 밀려 프리픽스 캐시가 불가능하므로
// 캐시에 태우지 않는다.
//
// 직전 요청은 원문 대신 메시지별 fingerprint(해시)로 pluginStorage에 남긴다 —
// 대화 평문을 공용 저장소에 노출하지 않고, database.bin 용량도 메시지당
// 수십 바이트로 고정되며, 세이브 동기화를 타고 다른 기기에서도 이어진다.

export function planCacheAnchors(
  previousState: CacheAnchorState | null,
  messages: readonly LlmMessage[],
): CachePlan {
  const fingerprints = messages.map(fingerprintMessage);

  if (previousState === null || previousState.fingerprints.length === 0) {
    return createFirstTurnPlan(fingerprints);
  }

  const previous = previousState.fingerprints;
  const prefixLength = commonPrefixLength(previous, fingerprints);

  // 공통 프리픽스가 전혀 없으면 다른 채팅방/캐릭터로의 전면 교체다 — 이전
  // 상태를 승계하면 무의미한 폴백 앵커가 남으므로 새 epoch(첫 턴)으로 처리한다.
  if (prefixLength === 0) {
    // fingerprints를 새 epoch 값으로 갈아끼워도 연속 실패 횟수는 이어가야
    // 매턴 변하는 선두 프리셋을 감지할 수 있다.
    return createFirstTurnPlan(fingerprints, previousState.consecutiveEpochResets + 1);
  }

  const suffixLength = commonSuffixLength(previous, fingerprints, prefixLength);
  if (prefixLength >= fingerprints.length) {
    // 현재 요청이 직전 요청의 프리픽스에 통째로 포함되는 경우(주의: 직전이
    // 현재의 프리픽스인 일반 성장과 반대 방향이다):
    // - 길이까지 같으면 동일 요청(리롤) — 현재 범위의 기존 앵커를 유지해
    //   후행 블록이 캐시에 실리지 않게 한다.
    // - 더 짧아졌으면(브랜치 삭제·요약 교체 등) 기존 앵커가 범위를 벗어날
    //   수 있어 첫 턴 정책으로 재추정한다.
    if (fingerprints.length < previous.length) {
      return createFirstTurnPlan(fingerprints);
    }

    const anchorIndexes = previousState.anchorIndexes.filter(
      (anchorIndex) => anchorIndex < fingerprints.length,
    );
    return {
      anchorIndexes,
      nextState: { anchorIndexes, consecutiveEpochResets: 0, fingerprints },
    };
  }

  const candidates = previousState.anchorIndexes.filter(
    (anchorIndex) => anchorIndex < prefixLength,
  );
  const previousFrontierIndex = previousState.anchorIndexes.at(-1);
  if (previousFrontierIndex !== undefined && prefixLength <= previousFrontierIndex) {
    candidates.push(prefixLength - 1);
  }
  candidates.push(fingerprints.length - suffixLength - 1);

  const anchorIndexes = normalizeAnchorIndexes(candidates, fingerprints);

  return {
    anchorIndexes,
    nextState: { anchorIndexes, consecutiveEpochResets: 0, fingerprints },
  };
}
