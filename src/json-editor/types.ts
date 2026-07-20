/** 문서 내 단일 위치. offset은 0-based, line/column은 1-based(사람이 읽는 표기) */
export interface TextPosition {
  offset: number;
  line: number;
  column: number;
}

export interface TextRange {
  start: TextPosition;
  end: TextPosition;
}

/** syntax: jsonc 파서의 구문 오류, schema: zod 검증 진단 */
export type DiagnosticSource = 'syntax' | 'schema';

export interface JsonDiagnostic {
  range: TextRange;
  message: string;
  severity: 'error' | 'warning';
  source: DiagnosticSource;
}

export interface BreadcrumbSegment {
  label: string;
  kind: 'key' | 'index';
}

export interface JsonCompletion {
  label: string;
  kind: 'property' | 'value';
  documentation?: string;
  /** prefix 매칭용 텍스트. label과 달리 따옴표가 포함될 수 있다 */
  filterText: string;
  /** [replaceStart, replaceEnd) 구간을 insertText로 치환한다 (offset 기준) */
  replaceStart: number;
  replaceEnd: number;
  insertText: string;
  /** 삽입 직후 선택할 insertText 내 상대 구간.
   *  placeholder가 있으면 그 구간을 선택해 바로 덮어쓸 수 있게 한다 */
  cursorStart: number;
  cursorEnd: number;
}

export interface JsonAnalysis {
  diagnostics: JsonDiagnostic[];
}

/** UI에 독립적인 에디터 코어. (text, offset) 좌표만 주고받으므로
 *  textarea가 아닌 다른 에디터 프론트로도 그대로 이식할 수 있다 */
export interface JsonEditorCore {
  /** 구문 + 스키마 진단. 구문 오류가 있으면 스키마 검증은 건너뛴다 */
  analyze(text: string): JsonAnalysis;
  breadcrumbAt(text: string, offset: number): BreadcrumbSegment[];
  completionsAt(text: string, offset: number): Promise<JsonCompletion[]>;
  /** 문서 전체 재정렬 (2칸 들여쓰기) */
  format(text: string): string;
}
