import { commitPromptCacheState, preparePromptCacheRequest } from '../cache';
import { getPromptCacheKey } from '../cache/mode/get-prompt-cache-key';
import type { ReplayCachePolicy } from '../sim';

export function createProductionCachePolicy(): ReplayCachePolicy {
  return {
    name: 'production',
    async apply(messages) {
      const prepared = await preparePromptCacheRequest([...messages], 'explicit');
      if (prepared.pendingCommit === null) {
        throw new Error('Production cache policy must prepare a bank commit.');
      }
      await commitPromptCacheState(prepared.pendingCommit);
      return {
        anchorIndexes: [],
        consecutiveEpochResets: 0,
        messages: prepared.requestMessages,
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
