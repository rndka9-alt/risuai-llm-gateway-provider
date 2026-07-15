import { describe, expect, it } from 'vitest';
import { MODEL_OPTIONS, resolveServiceTier } from '../options';
import { buildModelOptionList } from '../settings';

describe('resolveServiceTier', () => {
  it.each(['flex', 'default'])('%s 값을 그대로 반환한다', (value) => {
    expect(resolveServiceTier(value)).toBe(value);
  });

  it('공백을 제거하고 판별한다', () => {
    expect(resolveServiceTier(' flex ')).toBe('flex');
  });

  it.each([undefined, '', 'auto', 'priority'])(
    '지원하지 않는 값(%s)은 undefined를 반환해 body에서 생략되게 한다',
    (value) => {
      expect(resolveServiceTier(value)).toBeUndefined();
    },
  );
});

describe('buildModelOptionList', () => {
  it('프리셋 모델이면 목록을 그대로 반환한다', () => {
    expect(buildModelOptionList('gpt-5.6-terra')).toEqual(MODEL_OPTIONS);
  });

  it('커스텀 모델은 맨 앞에 추가해 유실을 막는다', () => {
    expect(buildModelOptionList('my-custom-model')).toEqual([
      'my-custom-model',
      ...MODEL_OPTIONS,
    ]);
  });
});
