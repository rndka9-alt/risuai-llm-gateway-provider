import { describe, expect, it } from 'vitest';
import * as z from 'zod';
import { createJsonEditorCore } from '../json-editor';

const testSchema = z.strictObject({
  name: z.string(),
  environment: z.enum(['development', 'staging', 'production']),
  port: z.int().optional(),
  database: z.strictObject({ host: z.string() }).optional(),
});

const core = createJsonEditorCore({ schema: testSchema });

function sliceRange(text: string, diagnosticIndex: number, diagnostics = core.analyze(text)) {
  const { range } = diagnostics.diagnostics[diagnosticIndex];
  return text.slice(range.start.offset, range.end.offset);
}

describe('analyze', () => {
  it('유효한 문서는 진단이 없다', () => {
    const text = '{\n  "name": "x",\n  "environment": "development"\n}';
    expect(core.analyze(text).diagnostics).toEqual([]);
  });

  it('구문 오류는 error 진단으로 위치를 짚고, 스키마 검증은 건너뛴다', () => {
    const { diagnostics } = core.analyze('{ "name": 1,, }');
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.every((diagnostic) => diagnostic.source === 'syntax')).toBe(true);
    expect(diagnostics.every((diagnostic) => diagnostic.severity === 'error')).toBe(true);
  });

  it('스키마 위반은 warning 진단으로 해당 값 범위를 짚는다', () => {
    const text = '{\n  "name": "x",\n  "environment": "dev"\n}';
    const { diagnostics } = core.analyze(text);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].source).toBe('schema');
    expect(diagnostics[0].severity).toBe('warning');
    expect(sliceRange(text, 0)).toBe('"dev"');
  });

  it('정의되지 않은 키는 키 이름 위치를 짚는다', () => {
    const text = '{\n  "name": "x",\n  "environment": "development",\n  "unknown": 1\n}';
    const { diagnostics } = core.analyze(text);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('정의되지 않은 키');
    expect(sliceRange(text, 0)).toBe('"unknown"');
  });

  it('누락된 필수 키는 경로를 메시지에 담는다', () => {
    const { diagnostics } = core.analyze('{\n  "name": "x"\n}');
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message.startsWith('$.environment')).toBe(true);
  });
});

describe('breadcrumbAt', () => {
  it('커서 위치의 JSON 경로를 계산한다', () => {
    const text = '{\n  "database": { "host": "localhost" }\n}';
    expect(core.breadcrumbAt(text, text.indexOf('localhost'))).toEqual([
      { label: 'database', kind: 'key' },
      { label: 'host', kind: 'key' },
    ]);
  });
});

describe('completionsAt', () => {
  it('빈 객체에서 속성 후보를 제안하고 snippet placeholder를 선택 구간으로 푼다', async () => {
    const completions = await core.completionsAt('{\n  \n}', 4);
    const labels = completions.map((completion) => completion.label);
    expect(labels).toEqual(expect.arrayContaining(['name', 'environment', 'port', 'database']));

    const nameCompletion = completions.find((completion) => completion.label === 'name');
    expect(nameCompletion?.insertText).toBe('"name": ""');

    const portCompletion = completions.find((completion) => completion.label === 'port');
    expect(portCompletion?.insertText).toBe('"port": 0');
    // "port": 0 의 placeholder(0)가 선택 구간으로 잡혀 삽입 직후 바로 덮어쓸 수 있어야 한다
    expect(portCompletion && portCompletion.cursorEnd - portCompletion.cursorStart).toBe(1);
  });

  it('enum 값 후보를 제안한다', async () => {
    const text = '{\n  "environment": \n}';
    const completions = await core.completionsAt(text, text.indexOf(': ') + 2);
    expect(completions.map((completion) => completion.label)).toEqual(
      expect.arrayContaining(['"development"', '"staging"', '"production"']),
    );
  });

  it('부분 입력된 토큰을 치환 범위로 덮는다', async () => {
    const text = '{\n  "en\n}';
    const completions = await core.completionsAt(text, 7);
    expect(completions.length).toBeGreaterThan(0);
    // 치환 시작~커서 구간이 이미 타이핑된 `"en` 을 덮어야 UI prefix 필터가 동작한다
    expect(text.slice(completions[0].replaceStart, 7)).toBe('"en');
  });
});

describe('format', () => {
  it('2칸 들여쓰기로 문서를 재정렬한다', () => {
    expect(core.format('{"name":"x","port":1}')).toBe('{\n  "name": "x",\n  "port": 1\n}');
  });
});
