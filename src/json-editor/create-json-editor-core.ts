import * as z from 'zod';
import type { JSONSchema } from 'vscode-json-languageservice';
import { createCompletionProvider } from './completion/create-completion-provider';
import { schemaDiagnostics } from './diagnostics/schema-diagnostics';
import { parseJson, syntaxDiagnostics } from './diagnostics/syntax-diagnostics';
import { breadcrumbAt } from './utils/breadcrumb-at';
import { formatJson } from './utils/format-json';
import { createTextIndex } from './utils/text-index';
import type { JsonEditorCore } from './types';

export interface JsonEditorCoreOptions {
  /** 필드명·enum 자동완성과 값 검증의 단일 소스.
   *  zod 스키마 하나에서 JSON Schema(자동완성용)와 safeParse(검증용)를 모두 파생한다 */
  schema: z.ZodType;
}

export function createJsonEditorCore(options: JsonEditorCoreOptions): JsonEditorCore {
  // zod와 vscode-json-languageservice가 같은 JSON Schema 문서를 서로 다른 TS 타입으로
  // 선언하므로, 타입 단언 대신 직렬화 왕복으로 순수 JSON임을 보장하며 경계를 넘긴다
  const jsonSchema: JSONSchema = JSON.parse(
    JSON.stringify(z.toJSONSchema(options.schema, { target: 'draft-07' })),
  );
  const completionProvider = createCompletionProvider(jsonSchema);

  return {
    analyze(text) {
      const textIndex = createTextIndex(text);
      const { root, errors } = parseJson(text);
      // 구문이 깨진 상태의 스키마 검증은 소음만 만들므로 구문 오류부터 해결하게 한다
      if (errors.length > 0 || !root) {
        return { diagnostics: syntaxDiagnostics(errors, textIndex) };
      }
      return { diagnostics: schemaDiagnostics(options.schema, root, textIndex) };
    },
    breadcrumbAt,
    completionsAt: completionProvider.completionsAt,
    format: formatJson,
  };
}
