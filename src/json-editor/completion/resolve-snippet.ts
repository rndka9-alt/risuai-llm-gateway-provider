export interface ResolvedSnippet {
  text: string;
  cursorStart: number;
  cursorEnd: number;
}

/** LSP snippet 문법($1, ${1:placeholder})을 plain text로 풀어낸다.
 *  textarea에는 tabstop 개념이 없으므로 첫 tabstop 구간을 선택 영역으로 돌려준다 */
export function resolveSnippet(snippet: string): ResolvedSnippet {
  let text = '';
  let cursorStart = -1;
  let cursorEnd = -1;
  let index = 0;

  while (index < snippet.length) {
    const dollarIndex = snippet.indexOf('$', index);
    if (dollarIndex === -1) {
      text += snippet.slice(index);
      break;
    }
    text += snippet.slice(index, dollarIndex);

    const remainder = snippet.slice(dollarIndex + 1);
    const bracedTabstop = remainder.match(/^\{\d+:?([^}]*)\}/);
    const bareTabstop = remainder.match(/^\d+/);
    if (bracedTabstop) {
      if (cursorStart === -1) {
        cursorStart = text.length;
        cursorEnd = text.length + bracedTabstop[1].length;
      }
      text += bracedTabstop[1];
      index = dollarIndex + 1 + bracedTabstop[0].length;
    } else if (bareTabstop) {
      if (cursorStart === -1) {
        cursorStart = text.length;
        cursorEnd = text.length;
      }
      index = dollarIndex + 1 + bareTabstop[0].length;
    } else {
      text += '$';
      index = dollarIndex + 1;
    }
  }

  if (cursorStart === -1) {
    cursorStart = text.length;
    cursorEnd = text.length;
  }
  return { text, cursorStart, cursorEnd };
}
