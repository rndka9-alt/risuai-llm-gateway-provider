import { CACHE_BACKOFF_BANK_MISS_THRESHOLD } from '../constants';

export function isCacheBackoffActive(consecutiveBankMisses: number): boolean {
  return consecutiveBankMisses >= CACHE_BACKOFF_BANK_MISS_THRESHOLD;
}
