import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIGURABLE_LLM_FLAG_NAMES,
  MODEL_OPTIONS,
  RISUAI_LLM_FLAGS,
  resolveConfigurableLlmFlagNames,
  resolveProviderLlmFlags,
  resolveReasoningEffort,
  resolveServiceTier,
  resolveStreamingMode,
  resolveVerbosity,
  serializeConfigurableLlmFlagNames,
} from '../options';
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

describe('OpenAI request option resolvers', () => {
  it.each(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])(
    'reasoning_effort %s를 허용한다',
    (value) => {
      expect(resolveReasoningEffort(value)).toBe(value);
    },
  );

  it.each(['low', 'medium', 'high'])('verbosity %s를 허용한다', (value) => {
    expect(resolveVerbosity(value)).toBe(value);
  });

  it.each([undefined, '', 'unknown'])('알 수 없는 선택값 %s는 생략한다', (value) => {
    expect(resolveReasoningEffort(value)).toBeUndefined();
    expect(resolveVerbosity(value)).toBeUndefined();
  });

  it.each(['off', 'decoupled', 'stream'])('streaming_mode %s를 판별한다', (value) => {
    expect(resolveStreamingMode(value)).toBe(value);
  });

  it.each([undefined, '', 'unknown'])('streaming_mode %s는 off로 정규화한다', (value) => {
    expect(resolveStreamingMode(value)).toBe('off');
  });
});

describe('RisuAI LLM flags', () => {
  it('미지정이면 Full System Prompt만 기본 활성화한다', () => {
    expect(resolveConfigurableLlmFlagNames(undefined)).toEqual(
      DEFAULT_CONFIGURABLE_LLM_FLAG_NAMES,
    );
  });

  it('지원 flag만 중복 없이 파싱하고 미디어 및 알 수 없는 이름은 제외한다', () => {
    expect(resolveConfigurableLlmFlagNames(
      'hasFirstSystemPrompt, hasImageInput, poolSupported, poolSupported, unknown',
    )).toEqual(['hasFirstSystemPrompt', 'poolSupported']);
  });

  it('이름을 본체 숫자로 변환하고 streaming_mode가 켜지면 hasStreaming을 자동 추가한다', () => {
    const flagNames = resolveConfigurableLlmFlagNames(
      'hasFullSystemPrompt,requiresAlternateRole',
    );

    expect(resolveProviderLlmFlags(flagNames, 'off')).toEqual([
      RISUAI_LLM_FLAGS.hasFullSystemPrompt,
      RISUAI_LLM_FLAGS.requiresAlternateRole,
    ]);
    expect(resolveProviderLlmFlags(flagNames, 'stream')).toEqual([
      RISUAI_LLM_FLAGS.hasFullSystemPrompt,
      RISUAI_LLM_FLAGS.requiresAlternateRole,
      RISUAI_LLM_FLAGS.hasStreaming,
    ]);
  });

  it('설정 저장 문자열은 콤마로 직렬화한다', () => {
    expect(serializeConfigurableLlmFlagNames([
      'hasFullSystemPrompt',
      'mustStartWithUserInput',
    ])).toBe('hasFullSystemPrompt,mustStartWithUserInput');
  });
});
