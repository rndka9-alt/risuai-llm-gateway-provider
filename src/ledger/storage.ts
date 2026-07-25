import { CACHE_LEDGER_STORAGE_KEY } from './constants';
import { cacheLedgerSchema, createEmptyCacheLedger, type CacheLedger } from './schema';
import { publishCacheLedger } from './snapshot';

// 손상·부재 원장은 0에서 새로 시작하는 것이 안전한 기본값이다. 여기서 throw하면
// 저장이 영영 갱신되지 않아 집계가 계속 실패하므로, 빈 원장으로 자가 회복한다.
export async function loadCacheLedger(): Promise<CacheLedger> {
  const raw = await risuai.pluginStorage.getItem(CACHE_LEDGER_STORAGE_KEY);
  if (typeof raw !== 'string' || raw === '') return createEmptyCacheLedger();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.error('[llm-gateway-provider] corrupted cache ledger; starting from zero', error);
    return createEmptyCacheLedger();
  }
  const result = cacheLedgerSchema.safeParse(parsed);
  return result.success ? result.data : createEmptyCacheLedger();
}

export async function refreshCacheLedgerSnapshot(): Promise<void> {
  publishCacheLedger(await loadCacheLedger());
}

export async function saveCacheLedger(ledger: CacheLedger): Promise<void> {
  await risuai.pluginStorage.setItem(CACHE_LEDGER_STORAGE_KEY, JSON.stringify(ledger));
  publishCacheLedger(ledger);
}
