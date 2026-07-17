import { CACHE_ANCHOR_STATE_STORAGE_KEY } from '../constants';
import type { CacheAnchorState } from './schema';

export async function saveCacheAnchorState(state: CacheAnchorState): Promise<void> {
  await risuai.pluginStorage.setItem(CACHE_ANCHOR_STATE_STORAGE_KEY, JSON.stringify(state));
}
