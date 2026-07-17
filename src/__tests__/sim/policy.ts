import type { LlmMessage } from 'llm-io';
import {
  getPromptCacheKey,
  loadCacheAnchorState,
  markCacheBreakpoints,
  planCacheAnchors,
  saveCacheAnchorState,
} from '../../cache';

export interface CachePolicyDecision {
  anchorIndexes: readonly number[];
  consecutiveEpochResets: number;
  messages: readonly LlmMessage[];
  promptCacheKey: string;
}

// 새 정책은 이 인터페이스만 구현하면 동일 trajectory와 gateway kernel을 재사용한다.
export interface ReplayCachePolicy {
  readonly name: string;
  apply(messages: readonly LlmMessage[]): Promise<CachePolicyDecision>;
}

export function createProductionCachePolicy(): ReplayCachePolicy {
  return {
    name: 'production',
    async apply(messages) {
      const previousState = await loadCacheAnchorState();
      const plan = planCacheAnchors(previousState, messages);
      const markedMessages = markCacheBreakpoints([...messages], plan);
      await saveCacheAnchorState(plan.nextState);
      return {
        anchorIndexes: plan.anchorIndexes,
        consecutiveEpochResets: plan.nextState.consecutiveEpochResets,
        messages: markedMessages,
        promptCacheKey: getPromptCacheKey('explicit'),
      };
    },
  };
}

export function createNoCachePolicy(): ReplayCachePolicy {
  return {
    name: 'no-cache',
    async apply(messages) {
      return {
        anchorIndexes: [],
        consecutiveEpochResets: 0,
        messages: [...messages],
        promptCacheKey: getPromptCacheKey('disabled'),
      };
    },
  };
}
