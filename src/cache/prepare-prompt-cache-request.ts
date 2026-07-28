import type { LlmMessage, OpenAIChatCompletionsExtraBody } from 'llm-io';
import { resolveCacheBackoffTransition } from './backoff/resolve-cache-backoff-transition';
import { markCacheBreakpoints } from './breakpoint/mark-cache-breakpoints';
import { createPromptCacheExtraBody } from './mode/create-prompt-cache-extra-body';
import { isExplicitPromptCacheMode } from './mode/is-explicit-prompt-cache-mode';
import { fingerprintMessage } from './planner/fingerprint-message';
import { planCacheAnchorsFromFingerprints } from './planner/plan-cache-anchors';
import { loadCacheAnchorBankSnapshot } from './state/bank/cache-anchor-bank-store';
import type { CacheAnchorBankSnapshot } from './state/bank/schema';
import {
  createNextCacheAnchorBankSnapshot,
  selectCacheAnchorBankState,
} from './state/bank/select-cache-anchor-bank-state';
import {
  pendingPromptCacheCommitData,
  type PendingPromptCacheCommit,
} from './state/pending-prompt-cache-commit';
import type { PromptCacheMode } from './types';

interface PreparedPromptCacheRequest {
  status: 'prepared';
  requestMessages: LlmMessage[];
  cacheExtraBody: OpenAIChatCompletionsExtraBody;
  pendingCommit: PendingPromptCacheCommit | null;
}

// 에러 클래스 대신 위치 기반 분류 — storage I/O만 담은 격리 블록의 실패라는 위치가
// 환경성 실패임을 보장한다. 소비자(provider)는 이를 LGP:ERR:102로 사용자에게 표면화한다.
interface PromptCacheStorageFailure {
  status: 'storage-failure';
  error: unknown;
}

export type PromptCacheRequestResult = PreparedPromptCacheRequest | PromptCacheStorageFailure;

export async function preparePromptCacheRequest(
  messages: LlmMessage[],
  mode: PromptCacheMode,
): Promise<PromptCacheRequestResult> {
  let cacheExtraBody: OpenAIChatCompletionsExtraBody;
  let previousSnapshot: CacheAnchorBankSnapshot;
  try {
    // 요청 전송 전이라 실패해도 중복 과금이 없다 — 조용한 캐시 생략 대신 표면화한다.
    cacheExtraBody = await createPromptCacheExtraBody(mode);
    // disabled 모드에서도 diff 기준은 계속 갱신한다 — explicit로 되돌렸을 때
    // 스테일 diff로 잘못된 앵커가 잡히는 것을 막는다.
    previousSnapshot = await loadCacheAnchorBankSnapshot();
  } catch (error) {
    return { status: 'storage-failure', error };
  }

  try {
    const fingerprints = messages.map(fingerprintMessage);
    const selection = selectCacheAnchorBankState(previousSnapshot, fingerprints);
    const plan = planCacheAnchorsFromFingerprints(selection.previousState, fingerprints);
    const nextSnapshot = createNextCacheAnchorBankSnapshot(
      previousSnapshot,
      selection,
      plan.nextState,
    );
    const requestMessages = isExplicitPromptCacheMode(mode)
      ? markCacheBreakpoints(messages, plan, nextSnapshot.consecutiveBankMisses)
      : messages;
    const transition = resolveCacheBackoffTransition(
      previousSnapshot.consecutiveBankMisses,
      nextSnapshot.consecutiveBankMisses,
    );

    return {
      status: 'prepared',
      requestMessages,
      cacheExtraBody,
      pendingCommit: {
        [pendingPromptCacheCommitData]: {
          nextSnapshot,
          transition,
          updatedSlot: selection.slot,
        },
      },
    };
  } catch (error) {
    // 순수 계획 단계의 예외는 플러그인 버그다 — 채팅을 막으면 수정 배포 전까지
    // 우회가 없으므로(disabled 모드도 이 경로를 탄다) 캐시 없이 요청을 이어간다.
    console.error(
      '[llm-gateway-provider] cache anchor handling failed; sending without breakpoints',
      error,
    );
    return { status: 'prepared', requestMessages: messages, cacheExtraBody, pendingCommit: null };
  }
}
