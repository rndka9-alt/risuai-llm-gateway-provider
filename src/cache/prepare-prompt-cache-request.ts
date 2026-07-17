import type { LlmMessage, OpenAIChatCompletionsExtraBody } from 'llm-io';
import { resolveCacheBackoffTransition } from './backoff/resolve-cache-backoff-transition';
import { markCacheBreakpoints } from './breakpoint/mark-cache-breakpoints';
import { createPromptCacheExtraBody } from './mode/create-prompt-cache-extra-body';
import { isExplicitPromptCacheMode } from './mode/is-explicit-prompt-cache-mode';
import { planCacheAnchors } from './planner/plan-cache-anchors';
import { loadCacheAnchorState } from './state/load-cache-anchor-state';
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
  // cache extra body 구성은 기존 anchor 격리 범위 밖에 있어, 실패 의미를 바꾸지 않는다.
  const cacheExtraBody = createPromptCacheExtraBody(mode);

  try {
    // disabled 모드에서도 diff 기준은 계속 갱신한다 — explicit로 되돌렸을 때
    // 스테일 diff로 잘못된 앵커가 잡히는 것을 막는다.
    const previousState = await loadCacheAnchorState();
    const plan = planCacheAnchors(previousState, messages);
    const requestMessages = isExplicitPromptCacheMode(mode)
      ? markCacheBreakpoints(messages, plan)
      : messages;
    const transition = resolveCacheBackoffTransition(previousState, plan.nextState);

    return {
      requestMessages,
      cacheExtraBody,
      pendingCommit: {
        [pendingPromptCacheCommitData]: {
          nextState: plan.nextState,
          transition,
        },
      },
    };
  } catch (error) {
    // 앵커 처리 실패가 채팅 요청까지 죽여선 안 된다 — 이번 요청은 캐시 없이 보낸다.
    console.error(
      '[llm-gateway-provider] cache anchor handling failed; sending without breakpoints',
      error,
    );
    return { requestMessages: messages, cacheExtraBody, pendingCommit: null };
  }
}
