export { accumulateCacheUsage, resetCacheLedger } from './ledger';
export { calculateNetSavedTokens } from './savings';
export { getCacheLedgerSnapshot, subscribeCacheLedger } from './snapshot';
export { refreshCacheLedgerSnapshot } from './storage';
export type { CacheLedger } from './schema';

// 여기부터는 테스트만 의존한다 (프로덕션 소비자 없음).
export {
  CACHE_LEDGER_STORAGE_KEY,
  CACHE_READ_SAVING_RATE,
  CACHE_WRITE_PREMIUM_RATE,
} from './constants';
export { calculateSavedUsd } from './savings';
export { createEmptyCacheLedger } from './schema';
export { loadCacheLedger } from './storage';
