import { describe, expect, it } from 'vitest';
import type { LlmMessage } from 'llm-io';
import {
  DISABLED_PROMPT_CACHE_KEY,
  EXPLICIT_PROMPT_CACHE_KEY,
  applyCacheBreakpoints,
  createPromptCacheExtraBody,
  getPromptCacheKey,
  resolvePromptCacheMode,
} from '../cache';

describe('prompt cache mode', () => {
  it('explicit 값만 explicit 모드로 판별한다', () => {
    expect(resolvePromptCacheMode('explicit')).toBe('explicit');
    expect(resolvePromptCacheMode(' explicit ')).toBe('explicit');
  });

  it.each([undefined, '', 'disabled', 'unknown'])('%s 값은 disabled 모드로 판별한다', (value) => {
    expect(resolvePromptCacheMode(value)).toBe('disabled');
  });
});

describe('prompt cache request wiring', () => {
  it('모드별 캐시 키를 선택한다', () => {
    expect(getPromptCacheKey('explicit')).toBe(EXPLICIT_PROMPT_CACHE_KEY);
    expect(getPromptCacheKey('disabled')).toBe(DISABLED_PROMPT_CACHE_KEY);
  });

  it.each([
    ['explicit', EXPLICIT_PROMPT_CACHE_KEY],
    ['disabled', DISABLED_PROMPT_CACHE_KEY],
  ] satisfies ReadonlyArray<readonly ['explicit' | 'disabled', string]>) (
    '%s 모드에 explicit 캐시 옵션과 해당 키를 구성한다',
    (mode, promptCacheKey) => {
      expect(createPromptCacheExtraBody(mode)).toEqual({
        prompt_cache_key: promptCacheKey,
        prompt_cache_options: { mode: 'explicit' },
      });
    },
  );
});

describe('applyCacheBreakpoints', () => {
  it('현재는 받은 메시지 배열의 동일성을 보존한다', () => {
    const messages: LlmMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'hello' }] },
    ];

    expect(applyCacheBreakpoints(messages)).toBe(messages);
  });
});
