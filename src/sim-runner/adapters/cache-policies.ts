import { getPromptCacheKey } from '../../cache/mode/get-prompt-cache-key';
import type { ReplayCachePolicy } from '../../sim';
import {
  createEmptyProductionCacheSnapshot,
  createProductionCacheTransition,
} from './production-cache-transition';

export function createProductionCachePolicy(): ReplayCachePolicy {
  let snapshot = createEmptyProductionCacheSnapshot();

  return {
    name: 'production',
    async apply(messages) {
      const transition = createProductionCacheTransition({
        messages,
        previousSnapshot: snapshot,
      });
      snapshot = transition.nextSnapshot;
      return {
        anchorIndexes: [],
        consecutiveEpochResets: 0,
        messages: transition.requestMessages,
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
