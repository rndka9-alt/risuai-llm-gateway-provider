import { parseTree, printParseErrorCode } from 'jsonc-parser';
import type { Node, ParseError } from 'jsonc-parser';
import type { TextIndex } from '../utils/text-index';
import type { JsonDiagnostic } from '../types';

export interface ParsedJson {
  root: Node | undefined;
  errors: ParseError[];
}

/** JSONC가 아닌 plain JSON 에디터이므로 주석·trailing comma도 오류로 취급한다 */
export function parseJson(text: string): ParsedJson {
  const errors: ParseError[] = [];
  const root = parseTree(text, errors, {
    allowTrailingComma: false,
    disallowComments: true,
  });
  return { root, errors };
}

/** printParseErrorCode가 주는 enum 이름을 사람이 읽을 메시지로 변환한다 */
const PARSE_ERROR_MESSAGES: Record<string, string> = {
  InvalidSymbol: '유효하지 않은 값이에요',
  InvalidNumberFormat: '숫자 형식이 잘못됐어요',
  PropertyNameExpected: '속성 이름이 와야 해요',
  ValueExpected: '값이 와야 해요',
  ColonExpected: '콜론(:)이 필요해요',
  CommaExpected: '쉼표(,)가 필요해요',
  CloseBraceExpected: '닫는 중괄호(})가 필요해요',
  CloseBracketExpected: '닫는 대괄호(])가 필요해요',
  EndOfFileExpected: '문서가 여기서 끝나야 해요',
  InvalidCommentToken: 'JSON에서는 주석을 쓸 수 없어요',
  UnexpectedEndOfComment: '주석이 닫히지 않았어요',
  UnexpectedEndOfString: '문자열이 닫히지 않았어요',
  UnexpectedEndOfNumber: '숫자가 완성되지 않았어요',
  InvalidUnicode: '유니코드 이스케이프가 잘못됐어요',
  InvalidEscapeCharacter: '이스케이프 문자가 잘못됐어요',
  InvalidCharacter: '문자열에 올 수 없는 문자예요',
};

export function syntaxDiagnostics(errors: ParseError[], textIndex: TextIndex): JsonDiagnostic[] {
  return errors.map((parseError): JsonDiagnostic => {
    const errorName = printParseErrorCode(parseError.error);
    return {
      // 길이 0짜리 오류(예: 파일 끝에서 값 누락)도 최소 1글자는 하이라이트되게 한다
      range: textIndex.rangeAt(parseError.offset, Math.max(parseError.length, 1)),
      message: PARSE_ERROR_MESSAGES[errorName] ?? errorName,
      severity: 'error',
      source: 'syntax',
    };
  });
}
