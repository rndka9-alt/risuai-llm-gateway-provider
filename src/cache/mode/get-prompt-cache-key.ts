import {
  DISABLED_PROMPT_CACHE_KEY,
  EXPLICIT_PROMPT_CACHE_KEY,
  PROMPT_CACHE_USER_SUFFIX_STORAGE_KEY,
} from '../constants';
import type { PromptCacheMode } from '../types';
import { isExplicitPromptCacheMode } from './is-explicit-prompt-cache-mode';

// 게이트웨이 prompt_cache_key 64자 제한 안에서 유저 간 분리에 충분한 64bit 엔트로피.
const USER_SUFFIX_PATTERN = /^[0-9a-f]{16}$/;

function generateUserSuffix(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function loadOrCreateUserSuffix(): Promise<string> {
  const stored = await risuai.pluginStorage.getItem(PROMPT_CACHE_USER_SUFFIX_STORAGE_KEY);
  if (typeof stored === 'string' && USER_SUFFIX_PATTERN.test(stored)) return stored;

  // 손상·이형 값은 새 suffix로 자가 회복한다 — 이전 키의 서버 캐시는 30m TTL로 소멸할 뿐이다.
  const created = generateUserSuffix();
  await risuai.pluginStorage.setItem(PROMPT_CACHE_USER_SUFFIX_STORAGE_KEY, created);
  return created;
}

// storage 실패를 여기서 삼키지 않는다 — preparePromptCacheRequest의 캐시 실패
// 격리가 base 키 폴백(getFallbackPromptCacheKey)으로 요청을 이어간다.
export async function getPromptCacheKey(mode: PromptCacheMode): Promise<string> {
  if (!isExplicitPromptCacheMode(mode)) return DISABLED_PROMPT_CACHE_KEY;
  return `${EXPLICIT_PROMPT_CACHE_KEY}:${await loadOrCreateUserSuffix()}`;
}

// storage에 닿지 않아 실패할 수 없는 base 키 — 폴백 요청은 breakpoint 없이 나가
// 캐시가 동작하지 않으므로 유저 분리 없는 공유 값으로 충분하다.
export function getFallbackPromptCacheKey(mode: PromptCacheMode): string {
  return isExplicitPromptCacheMode(mode) ? EXPLICIT_PROMPT_CACHE_KEY : DISABLED_PROMPT_CACHE_KEY;
}
