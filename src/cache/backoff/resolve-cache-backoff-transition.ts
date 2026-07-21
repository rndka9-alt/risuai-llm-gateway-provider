import type { CacheBackoffTransition } from '../types';
import { isCacheBackoffActive } from './is-cache-backoff-active';

export function resolveCacheBackoffTransition(
  previousConsecutiveBankMisses: number,
  nextConsecutiveBankMisses: number,
): CacheBackoffTransition | null {
  const wasActive = isCacheBackoffActive(previousConsecutiveBankMisses);
  const isActive = isCacheBackoffActive(nextConsecutiveBankMisses);
  if (wasActive === isActive) return null;
  return isActive ? 'activated' : 'released';
}
