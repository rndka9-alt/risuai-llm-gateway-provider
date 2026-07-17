import { CACHE_ANCHOR_STATE_STORAGE_KEY } from '../constants';
import { cacheAnchorStateSchema, type CacheAnchorState } from './schema';

// ===== 상태 저장 =====

// 손상·부재 상태는 새 epoch로 시작하는 것이 안전한 기본값이다. 여기서 throw하면
// 저장이 영영 갱신되지 않아 매 요청 실패가 반복되므로, null 반환으로 자가 회복한다.
export async function loadCacheAnchorState(): Promise<CacheAnchorState | null> {
  const raw = await risuai.pluginStorage.getItem(CACHE_ANCHOR_STATE_STORAGE_KEY);
  if (typeof raw !== 'string' || raw === '') return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.error(
      '[llm-gateway-provider] corrupted cache anchor state; starting a new epoch',
      error,
    );
    return null;
  }
  const result = cacheAnchorStateSchema.safeParse(parsed);
  return result.success ? result.data : null;
}
