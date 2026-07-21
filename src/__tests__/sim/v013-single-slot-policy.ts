import type { ReplayCachePolicy } from './policy';
import {
  type CacheAnchorState,
  EXPLICIT_PROMPT_CACHE_KEY,
  markCacheBreakpoints,
  planCacheAnchors,
} from './v013-single-slot-vendor';

export function createV013SingleSlotCachePolicy(): ReplayCachePolicy {
  let state: CacheAnchorState | null = null;

  return {
    name: 'v013-single-slot',
    async apply(messages) {
      const plan = planCacheAnchors(state, messages);
      const markedMessages = markCacheBreakpoints([...messages], plan);
      state = plan.nextState;
      return {
        anchorIndexes: plan.anchorIndexes,
        consecutiveEpochResets: plan.nextState.consecutiveEpochResets,
        messages: markedMessages,
        promptCacheKey: EXPLICIT_PROMPT_CACHE_KEY,
      };
    },
  };
}
