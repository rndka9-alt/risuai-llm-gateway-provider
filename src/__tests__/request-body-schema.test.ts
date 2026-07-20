import { describe, expect, it } from 'vitest';
import {
  createJsonEditorCore,
  gpt56ChatCompletionsRequestSchema,
  gpt56ExcludedKeyMessages,
} from '../json-editor';

const validBody = {
  model: 'gpt-5.6-sol',
  messages: [{ role: 'user', content: '안녕' }],
  max_tokens: 1024,
  reasoning_effort: 'max',
};

describe('gpt56ChatCompletionsRequestSchema', () => {
  it('유효한 요청 body를 통과시킨다', () => {
    expect(gpt56ChatCompletionsRequestSchema.safeParse(validBody).success).toBe(true);
  });

  it('필수 필드 없는 부분 body도 통과한다 — 필수값은 플러그인이 채운다', () => {
    expect(gpt56ChatCompletionsRequestSchema.safeParse({ reasoning_effort: 'max' }).success).toBe(
      true,
    );
    expect(gpt56ChatCompletionsRequestSchema.safeParse({}).success).toBe(true);
  });

  it('GPT-5.6 upstream이 400으로 거절하는 reasoning_effort minimal을 막는다', () => {
    const result = gpt56ChatCompletionsRequestSchema.safeParse({
      ...validBody,
      reasoning_effort: 'minimal',
    });
    expect(result.success).toBe(false);
  });

  it('reasoning_effort와 reasoning.effort 동시 사용을 막는다', () => {
    const result = gpt56ChatCompletionsRequestSchema.safeParse({
      ...validBody,
      reasoning: { effort: 'low' },
    });
    expect(result.success).toBe(false);
  });

  it('Gateway가 조용히 버리는 필드(max_completion_tokens)를 정의되지 않은 키로 잡는다', () => {
    const result = gpt56ChatCompletionsRequestSchema.safeParse({
      ...validBody,
      max_completion_tokens: 1024,
    });
    expect(result.success).toBe(false);
    expect(
      !result.success && result.error.issues.some((issue) => issue.code === 'unrecognized_keys'),
    ).toBe(true);
  });

  it('breakpoint 4개 초과를 막는다', () => {
    const breakpointPart = (text: string) => ({
      type: 'text',
      text,
      prompt_cache_breakpoint: { mode: 'explicit' },
    });
    const result = gpt56ChatCompletionsRequestSchema.safeParse({
      model: 'gpt-5.6-sol',
      messages: [{ role: 'user', content: [1, 2, 3, 4, 5].map((n) => breakpointPart(`m${n}`)) }],
    });
    expect(result.success).toBe(false);
  });

  it('플러그인 소유 필드(stream, prompt_cache_*)는 세트에서 빠져 정의되지 않은 키 워닝이 된다', () => {
    const pluginOwnedBodies = [
      { ...validBody, stream: true },
      { ...validBody, prompt_cache_key: 'key' },
      { ...validBody, prompt_cache_options: { mode: 'explicit' } },
    ];
    for (const body of pluginOwnedBodies) {
      const result = gpt56ChatCompletionsRequestSchema.safeParse(body);
      expect(result.success).toBe(false);
      expect(
        !result.success && result.error.issues.some((issue) => issue.code === 'unrecognized_keys'),
      ).toBe(true);
    }
  });

  it('breakpoint만 있는 부분 body는 통과한다 — explicit 모드는 플러그인 캐시 설정이 채운다', () => {
    const result = gpt56ChatCompletionsRequestSchema.safeParse({
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'm', prompt_cache_breakpoint: { mode: 'explicit' } }],
        },
      ],
    });
    expect(result.success).toBe(true);
  });
});

describe('json-editor 통합', () => {
  const core = createJsonEditorCore({
    schema: gpt56ChatCompletionsRequestSchema,
    unrecognizedKeyMessages: gpt56ExcludedKeyMessages,
  });

  it('플러그인 소유 키에는 정의되지 않은 키 대신 대체 수단 안내가 뜬다', () => {
    const { diagnostics } = core.analyze(JSON.stringify({ ...validBody, stream: true }, null, 2));
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('응답 방식 설정');
    expect(diagnostics[0].severity).toBe('warning');
  });

  it('빈 body에서 최상위 필드 자동완성을 제안한다', async () => {
    const completions = await core.completionsAt('{\n  \n}', 4);
    const labels = completions.map((completion) => completion.label);
    expect(labels).toEqual(
      expect.arrayContaining(['model', 'messages', 'reasoning_effort', 'max_tokens']),
    );
  });

  it('model enum 값 자동완성을 제안한다', async () => {
    const text = '{\n  "model": \n}';
    const completions = await core.completionsAt(text, text.indexOf(': ') + 2);
    expect(completions.map((completion) => completion.label)).toEqual(
      expect.arrayContaining(['"gpt-5.6-sol"', '"gpt-5.6-terra"', '"gpt-5.6-luna"']),
    );
  });

  it('유효 body는 진단이 없고, 스키마 위반은 warning 진단이 된다', () => {
    expect(core.analyze(JSON.stringify(validBody, null, 2)).diagnostics).toEqual([]);

    const invalidText = JSON.stringify({ ...validBody, reasoning_effort: 'minimal' }, null, 2);
    const { diagnostics } = core.analyze(invalidText);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.every((diagnostic) => diagnostic.severity === 'warning')).toBe(true);
  });
});
