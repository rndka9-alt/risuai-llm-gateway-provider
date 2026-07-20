import { describe, expect, it, vi } from 'vitest';
import { applyCustomExtraBody, mergeExtraBody, parseCustomExtraBody } from '../extra-body';

describe('parseCustomExtraBody', () => {
  it('빈 초안은 적용 안 함으로 취급한다', () => {
    expect(parseCustomExtraBody('')).toBeUndefined();
    expect(parseCustomExtraBody('  \n')).toBeUndefined();
  });

  it('invalid JSON은 경고 후 전부 버린다', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(parseCustomExtraBody('{ "a": ')).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('object가 아닌 JSON도 버린다', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(parseCustomExtraBody('[1, 2]')).toBeUndefined();
    expect(parseCustomExtraBody('"text"')).toBeUndefined();
    expect(parseCustomExtraBody('3')).toBeUndefined();
    warn.mockRestore();
  });

  it('유효한 object는 그대로 파싱한다', () => {
    expect(parseCustomExtraBody('{ "reasoning_effort": "max" }')).toEqual({
      reasoning_effort: 'max',
    });
  });
});

describe('mergeExtraBody', () => {
  it('중첩 object는 재귀 병합하고 겹치는 필드는 custom이 덮어쓴다', () => {
    const base = {
      reasoning_effort: 'medium',
      prompt_cache_options: { mode: 'explicit', ttl: '30m' },
    };
    const custom = {
      reasoning_effort: 'max',
      prompt_cache_options: { mode: 'implicit' },
      web_search: true,
    };
    expect(mergeExtraBody(base, custom)).toEqual({
      reasoning_effort: 'max',
      prompt_cache_options: { mode: 'implicit', ttl: '30m' },
      web_search: true,
    });
  });

  it('배열과 타입 불일치 값은 통째로 덮어쓴다', () => {
    const base = { tools: [{ type: 'function' }], stream_options: { include_usage: true } };
    const custom = { tools: [{ type: 'web_search' }], stream_options: null };
    expect(mergeExtraBody(base, custom)).toEqual({
      tools: [{ type: 'web_search' }],
      stream_options: null,
    });
  });

  it('원본 base 객체를 변형하지 않는다', () => {
    const base = { prompt_cache_options: { mode: 'explicit' } };
    mergeExtraBody(base, { prompt_cache_options: { mode: 'implicit' } });
    expect(base.prompt_cache_options.mode).toBe('explicit');
  });
});

describe('applyCustomExtraBody', () => {
  it('커스텀이 없으면 원본을 그대로 반환한다', () => {
    const baseExtraBody = { reasoning_effort: 'medium' } as const;
    expect(applyCustomExtraBody(baseExtraBody, '')).toBe(baseExtraBody);
  });

  it('커스텀을 deep merge해 요청용 extraBody를 만든다', () => {
    const merged = applyCustomExtraBody(
      { reasoning_effort: 'medium', stream_options: { include_usage: true } },
      '{ "reasoning_effort": "max", "verbosity": "low" }',
    );
    expect(merged).toEqual({
      reasoning_effort: 'max',
      verbosity: 'low',
      stream_options: { include_usage: true },
    });
  });
});
