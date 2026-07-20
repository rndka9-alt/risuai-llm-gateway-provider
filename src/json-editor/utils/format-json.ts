import { applyEdits, format } from 'jsonc-parser';

/** 2칸 들여쓰기 기준으로 문서 전체를 재정렬한다. 구문이 깨진 부분은 가능한 범위까지만 정렬된다 */
export function formatJson(text: string): string {
  const edits = format(text, undefined, { insertSpaces: true, tabSize: 2, eol: '\n' });
  return applyEdits(text, edits);
}
