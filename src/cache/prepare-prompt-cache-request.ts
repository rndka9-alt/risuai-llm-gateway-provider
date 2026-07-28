import type { LlmMessage, OpenAIChatCompletionsExtraBody } from 'llm-io';
import { resolveCacheBackoffTransition } from './backoff/resolve-cache-backoff-transition';
import { markCacheBreakpoints } from './breakpoint/mark-cache-breakpoints';
import {
  createFallbackPromptCacheExtraBody,
  createPromptCacheExtraBody,
} from './mode/create-prompt-cache-extra-body';
import { isExplicitPromptCacheMode } from './mode/is-explicit-prompt-cache-mode';
import { fingerprintMessage } from './planner/fingerprint-message';
import { planCacheAnchorsFromFingerprints } from './planner/plan-cache-anchors';
import { loadCacheAnchorBankSnapshot } from './state/bank/cache-anchor-bank-store';
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
  requestMessages: LlmMessage[];
  cacheExtraBody: OpenAIChatCompletionsExtraBody;
  pendingCommit: PendingPromptCacheCommit | null;
}

export async function preparePromptCacheRequest(
  messages: LlmMessage[],
  mode: PromptCacheMode,
): Promise<PreparedPromptCacheRequest> {
  try {
    // 유저별 키 로드가 storage를 읽으므로 anchor 처리와 같은 실패 격리 안에 둔다.
    const cacheExtraBody = await createPromptCacheExtraBody(mode);

    // disabled 모드에서도 diff 기준은 계속 갱신한다 — explicit로 되돌렸을 때
    // 스테일 diff로 잘못된 앵커가 잡히는 것을 막는다.
    const previousSnapshot = await loadCacheAnchorBankSnapshot();
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
    // 캐시 처리 실패(유저별 키 로드·앵커 처리)가 채팅 요청까지 죽여선 안 된다 —
    // 이번 요청은 breakpoint 없이 base 키 폴백으로 보낸다.
    console.error(
      '[llm-gateway-provider] cache anchor handling failed; sending without breakpoints',
      error,
    );
    return {
      requestMessages: messages,
      cacheExtraBody: createFallbackPromptCacheExtraBody(mode),
      pendingCommit: null,
    };
  }
}
