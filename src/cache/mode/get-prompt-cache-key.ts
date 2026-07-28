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

// storage 실패를 여기서 삼키지 않는다 — preparePromptCacheRequest의 storage 격리
// 블록이 받아 요청 전송 전 실패(LGP:ERR:102)로 사용자에게 표면화한다.
export async function getPromptCacheKey(mode: PromptCacheMode): Promise<string> {
  if (!isExplicitPromptCacheMode(mode)) return DISABLED_PROMPT_CACHE_KEY;
  return `${EXPLICIT_PROMPT_CACHE_KEY}:${await loadOrCreateUserSuffix()}`;
}
