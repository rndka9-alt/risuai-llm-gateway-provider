import type { CacheAnchorState } from '../state/schema';
import type { CacheBackoffTransition } from '../types';
import { isCacheBackoffActive } from './is-cache-backoff-active';

export function resolveCacheBackoffTransition(
  previousState: CacheAnchorState | null,
  nextState: CacheAnchorState,
): CacheBackoffTransition | null {
  const wasActive = isCacheBackoffActive(previousState);
  const isActive = isCacheBackoffActive(nextState);
  if (wasActive === isActive) return null;
  return isActive ? 'activated' : 'released';
}
