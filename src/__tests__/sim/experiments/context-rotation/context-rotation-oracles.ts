import type { LlmMessage } from 'llm-io';
import { markCacheBreakpoints } from '../../../../cache/breakpoint/mark-cache-breakpoints';
import { fingerprintMessage } from '../../../../cache/planner/fingerprint-message';
import type { MessageFingerprint } from '../../../../cache/state/schema';
import type { CachePlan } from '../../../../cache/types';
import type { ReplayCachePolicy } from '../../cache-strategies';
import type { ContextRotationScenario } from './context-rotation-scenarios';

// 캐시 키는 시뮬레이터의 엔트리 네임스페이스로 안정성만 필요하다 — 프로덕션 키 값과 무관한 고정 픽스처.
const SIM_PROMPT_CACHE_KEY = 'sim:prompt-cache-key';

/**
 * 실험 로컬 오라클 봉투. 시나리오 생성기가 실어 보낸 구조 메타데이터를 읽는
 * 참조선으로, 구조를 미리 아는 이론선일 뿐 실구현 예상치가 아니다.
 *
 * - oracle-stable-head: 불변 헤드 경계 하나만 마킹하는 하한 봉투. 0.9·H/M
 *   예측선의 실측 대응물이다.
 * - oracle-surviving-frontier: 다음 요청까지 실제로 살아남는 가장 깊은 경계를
 *   마킹하는 상한 봉투. production과의 격차가 정책이 회수할 수 있는 여지다.
 */

// 시나리오의 메시지 객체는 요청 간에 재사용되므로 fingerprint를 객체 단위로
// 캐싱해 대형 셀에서의 반복 직렬화 비용을 줄인다.
const fingerprintCache = new WeakMap<LlmMessage, MessageFingerprint>();

function cachedFingerprint(message: LlmMessage): MessageFingerprint {
  const cached = fingerprintCache.get(message);
  if (cached !== undefined) return cached;
  const fingerprint = fingerprintMessage(message);
  fingerprintCache.set(message, fingerprint);
  return fingerprint;
}

interface ContextRotationOracleOptions {
  includeSurvivingFrontier: boolean;
  name: 'oracle-stable-head' | 'oracle-surviving-frontier';
}

function createContextRotationOraclePolicy(
  scenario: ContextRotationScenario,
  options: ContextRotationOracleOptions,
): ReplayCachePolicy {
  let requestIndex = 0;
  return {
    name: options.name,
    async apply(messages) {
      if (requestIndex >= scenario.requests.length) {
        throw new RangeError(`Oracle received more requests than ${scenario.id} defines.`);
      }

      const anchorIndexes = new Set<number>([scenario.headMessageCount - 1]);
      if (options.includeSurvivingFrontier) {
        // 직전 요청과의 공통 경계는 정의상 현재 요청의 프리픽스이므로 그대로
        // 수확(read) 지점이 되고, 다음 요청과의 공통 경계는 write 지점이 된다.
        const previousBoundaryCount =
          requestIndex === 0 ? 0 : scenario.survivingPrefixMessageCounts[requestIndex - 1];
        const currentBoundaryCount = scenario.survivingPrefixMessageCounts[requestIndex];
        [previousBoundaryCount, currentBoundaryCount].forEach((boundaryMessageCount) => {
          if (boundaryMessageCount >= 1 && boundaryMessageCount <= messages.length) {
            anchorIndexes.add(boundaryMessageCount - 1);
          }
        });
      }

      const sortedAnchorIndexes = [...anchorIndexes].sort((left, right) => left - right);
      if (sortedAnchorIndexes.length > 4) {
        throw new RangeError(`Oracle for ${scenario.id} cannot emit more than four anchors.`);
      }
      sortedAnchorIndexes.forEach((anchorIndex) => {
        // assistant 경계는 마킹 계층이 조용히 얕은 지점으로 물러나 write/read
        // 짝이 어긋난다. 생성기 구조상 나올 수 없으므로 나오면 생성기 버그다.
        if (messages[anchorIndex]?.role === 'assistant') {
          throw new Error(`Oracle boundary for ${scenario.id} landed on an assistant message.`);
        }
      });

      const fingerprints = messages.map(cachedFingerprint);
      const plan: CachePlan = {
        anchorIndexes: sortedAnchorIndexes,
        markingAnchorIndexes: sortedAnchorIndexes,
        nextState: {
          anchorAdmissions: [],
          anchorIndexes: sortedAnchorIndexes,
          consecutiveEpochResets: 0,
          consecutiveFrontierDeaths: 0,
          fingerprints,
        },
      };
      const markedMessages = markCacheBreakpoints([...messages], plan);
      requestIndex += 1;

      return {
        anchorIndexes: sortedAnchorIndexes,
        consecutiveEpochResets: 0,
        messages: markedMessages,
        promptCacheKey: SIM_PROMPT_CACHE_KEY,
      };
    },
  };
}

export function createStableHeadOraclePolicy(
  scenario: ContextRotationScenario,
): ReplayCachePolicy {
  return createContextRotationOraclePolicy(scenario, {
    includeSurvivingFrontier: false,
    name: 'oracle-stable-head',
  });
}

export function createSurvivingFrontierOraclePolicy(
  scenario: ContextRotationScenario,
): ReplayCachePolicy {
  return createContextRotationOraclePolicy(scenario, {
    includeSurvivingFrontier: true,
    name: 'oracle-surviving-frontier',
  });
}
