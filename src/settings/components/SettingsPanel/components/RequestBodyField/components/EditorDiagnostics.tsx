import type { JsonDiagnostic } from '../../../../../../json-editor';

interface EditorDiagnosticsProps {
  diagnostics: JsonDiagnostic[];
  onSelect(diagnostic: JsonDiagnostic): void;
}

/** 진단을 전부 나열하지 않고 문서 앞쪽 것 하나만 보여준다 — 고치면 다음 진단이 이어서 드러난다 */
export function EditorDiagnostics({ diagnostics, onSelect }: EditorDiagnosticsProps) {
  const sortedDiagnostics = [...diagnostics].sort(
    (a, b) => a.range.start.offset - b.range.start.offset,
  );
  const firstDiagnostic = sortedDiagnostics[0];
  if (!firstDiagnostic) return null;

  const remainingCount = diagnostics.length - 1;

  return (
    <button
      type="button"
      onClick={() => onSelect(firstDiagnostic)}
      class="flex w-full cursor-pointer items-baseline gap-1.5 border-0 bg-transparent px-0.5 py-0.5 text-left text-xs"
    >
      <span
        class={`shrink-0 font-medium ${
          firstDiagnostic.severity === 'error' ? 'text-ui-loss' : 'text-ui-warn'
        }`}
      >
        {firstDiagnostic.source === 'syntax' ? '구문' : '스키마'}
      </span>
      <span class="shrink-0 font-mono text-ui-muted">
        {firstDiagnostic.range.start.line}:{firstDiagnostic.range.start.column}
      </span>
      {/* zod 메시지의 "a"|"b"... 같은 긴 무공백 토큰이 패널 가로 스크롤을 만들지 않게 꺾는다 */}
      <span class="min-w-0 flex-1 break-words text-ui-content">{firstDiagnostic.message}</span>
      {remainingCount > 0 && <span class="shrink-0 text-ui-muted">외 {remainingCount}개</span>}
    </button>
  );
}
