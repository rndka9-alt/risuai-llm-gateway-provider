import { CACHE_BACKOFF_EPOCH_RESET_THRESHOLD } from '../constants';
import type { CacheAnchorState } from '../state/schema';

export function isCacheBackoffActive(state: CacheAnchorState | null): boolean {
  return (
    state !== null &&
    state.consecutiveEpochResets >= CACHE_BACKOFF_EPOCH_RESET_THRESHOLD
  );
}
