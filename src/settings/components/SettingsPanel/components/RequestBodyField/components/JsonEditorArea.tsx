import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { MutableRef } from 'preact/hooks';
import type { JSX } from 'preact';
import type { JsonCompletion, JsonDiagnostic, JsonEditorCore } from '../../../../../../json-editor';
import { measureCaretRect } from '../utils/measure-caret-rect';
import { CompletionPopup } from './CompletionPopup';

/** EditorDiagnostics처럼 바깥에서 에디터를 조작할 때 쓰는 명령형 API */
export interface JsonEditorApi {
  focusRange(start: number, end: number): void;
}

interface JsonEditorAreaProps {
  value: string;
  diagnostics: JsonDiagnostic[];
  core: JsonEditorCore;
  apiRef: MutableRef<JsonEditorApi | null>;
  onChange(next: string): void;
  onCaretChange(offset: number): void;
  /** blur 시점의 확정 값 — pluginStorage 저장 트리거 */
  onCommit(value: string): void;
}

/** textarea와 backdrop이 같은 글꼴 metrics를 공유해야 하이라이트가 글자 위에 정확히 겹친다 */
const EDITOR_TEXT_CLASS =
  'touch-input-text p-2.5 font-mono text-xs leading-5 whitespace-pre-wrap break-words';

/** 스키마 warning은 '권장에서 벗어남' 톤이 되도록 에러(물결)보다 옅은 점선으로 표시한다 */
const HIGHLIGHT_CLASSES = {
  error: 'bg-ui-loss/20 decoration-ui-loss decoration-wavy',
  warning: 'bg-ui-warn/15 decoration-ui-warn/80 decoration-dotted',
} as const;

const COMPLETION_POPUP_WIDTH = 260;
/** 뒤집기 판정용 팝업 최대 높이 추정 — 목록 max-h-40(160px) + 테두리·패딩 여유 */
const ESTIMATED_POPUP_HEIGHT = 176;

interface CompletionState {
  completions: JsonCompletion[];
  selectedIndex: number;
  /** top(아래로 열기) 또는 bottom(위로 열기) 중 하나만 갖는다 */
  anchor: { top?: number; bottom?: number; left: number };
}

export function JsonEditorArea({
  value,
  diagnostics,
  core,
  apiRef,
  onChange,
  onCaretChange,
  onCommit,
}: JsonEditorAreaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const pendingSelectionRef = useRef<{ start: number; end: number } | null>(null);
  const completionRequestRef = useRef(0);
  const [completionState, setCompletionState] = useState<CompletionState | null>(null);

  useLayoutEffect(() => {
    apiRef.current = {
      focusRange(start, end) {
        const textarea = textareaRef.current;
        if (!textarea) return;
        textarea.focus();
        textarea.setSelectionRange(start, end);
        onCaretChange(start);
      },
    };
  });

  // 자동완성 적용으로 value가 반영된 다음에야 setSelectionRange가 유효하다
  useLayoutEffect(() => {
    const pendingSelection = pendingSelectionRef.current;
    if (!pendingSelection) return;
    pendingSelectionRef.current = null;
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.focus();
    textarea.setSelectionRange(pendingSelection.start, pendingSelection.end);
  }, [value]);

  function closeCompletions(): void {
    // 진행 중인 요청이 늦게 도착해 팝업을 되살리지 않도록 요청 세대를 올린다
    completionRequestRef.current += 1;
    setCompletionState(null);
  }

  async function requestCompletions(text: string, offset: number): Promise<void> {
    const requestId = completionRequestRef.current + 1;
    completionRequestRef.current = requestId;
    const completions = await core.completionsAt(text, offset);
    if (requestId !== completionRequestRef.current) return;
    const textarea = textareaRef.current;
    if (!textarea) return;

    const filtered = filterCompletions(completions, text, offset);
    if (filtered.length === 0) {
      setCompletionState(null);
      return;
    }
    const caretRect = measureCaretRect(textarea, offset);
    // 좁은 설정 패널에서 팝업이 오른쪽으로 삐져나가지 않게 잡아둔다
    const left = Math.max(
      0,
      Math.min(caretRect.left, textarea.clientWidth - COMPLETION_POPUP_WIDTH),
    );
    // 아래 공간이 부족하면 caret 위쪽에 bottom-anchor로 뒤집어 연다.
    // 판정 경계는 iframe 뷰포트가 아니라 팝업이 실제로 잘리는 컨테이너 — 팝업은
    // 패널(main, overflow-auto) 안에 살므로 "패널 가시 영역 ∩ iframe 뷰포트"를 쓴다.
    // bottom 기준이라 항목 수가 적어 팝업이 낮아져도 caret 바로 위에 붙는다
    const textareaRect = textarea.getBoundingClientRect();
    const panelRect = textarea.closest('main')?.getBoundingClientRect();
    const boundaryTop = Math.max(0, panelRect?.top ?? 0);
    const boundaryBottom = Math.min(window.innerHeight, panelRect?.bottom ?? window.innerHeight);
    const caretTopInViewport = textareaRect.top + caretRect.top;
    const spaceBelow = boundaryBottom - (caretTopInViewport + caretRect.height);
    const spaceAbove = caretTopInViewport - boundaryTop;
    const flipUp = spaceBelow < ESTIMATED_POPUP_HEIGHT && spaceAbove > spaceBelow;
    setCompletionState({
      completions: filtered,
      selectedIndex: 0,
      anchor: flipUp
        ? { bottom: textarea.offsetHeight - caretRect.top + 2, left }
        : { top: caretRect.top + caretRect.height + 2, left },
    });
  }

  function applyCompletion(completion: JsonCompletion): void {
    const nextValue =
      value.slice(0, completion.replaceStart) +
      completion.insertText +
      value.slice(completion.replaceEnd);
    pendingSelectionRef.current = {
      start: completion.replaceStart + completion.cursorStart,
      end: completion.replaceStart + completion.cursorEnd,
    };
    closeCompletions();
    onChange(nextValue);
    onCaretChange(completion.replaceStart + completion.cursorEnd);
    // 속성 완성 직후 그 자리의 값 후보(enum 등)로 자동으로 이어지게 체인 트리거한다
    void requestCompletions(nextValue, completion.replaceStart + completion.cursorEnd);
  }

  function moveSelection(delta: number): void {
    setCompletionState((previous) => {
      if (!previous) return previous;
      const count = previous.completions.length;
      return { ...previous, selectedIndex: (previous.selectedIndex + delta + count) % count };
    });
  }

  function handleInput(nextValue: string, caretOffset: number): void {
    const isDeletion = nextValue.length < value.length;
    onChange(nextValue);
    onCaretChange(caretOffset);

    const insertedCharacter = isDeletion ? '' : nextValue.slice(caretOffset - 1, caretOffset);
    // 쉼표·줄바꿈 직후에 팝업이 남아 있으면 "다음 줄로 가려는 Enter"가
    // 완성 수락으로 오작동하므로 무조건 닫는다
    if (insertedCharacter === ',' || insertedCharacter === '\n') {
      closeCompletions();
      return;
    }
    // 닫혀 있을 때는 키·값 입력이 시작되는 문자에서만 새로 연다.
    // 열려 있을 때는 (백스페이스 포함) 어떤 입력이든 목록을 갱신한다
    if (
      completionState === null &&
      (isDeletion || !shouldOpenCompletion(insertedCharacter, nextValue, caretOffset))
    ) {
      return;
    }
    void requestCompletions(nextValue, caretOffset);
  }

  function handleKeyDown(event: JSX.TargetedKeyboardEvent<HTMLTextAreaElement>): void {
    // 한글 IME 조합 중의 Enter/방향키를 가로채면 조합이 깨진다
    if (event.isComposing) return;

    // Ctrl+Space는 macOS 한영 전환과 겹치므로 ⌥+Space도 수동 트리거로 지원한다.
    // ⌥+Space가 만드는 문자(NBSP 등)는 브라우저마다 달라 event.code로 물리 키를 본다
    if (event.code === 'Space' && (event.ctrlKey || event.altKey)) {
      event.preventDefault();
      void requestCompletions(event.currentTarget.value, event.currentTarget.selectionStart);
      return;
    }
    // macOS에서 ⇧⌥F는 특수문자를 입력하므로 event.key 대신 물리 키(code)로 판별한다
    if (event.code === 'KeyF' && event.altKey && event.shiftKey) {
      event.preventDefault();
      const currentValue = event.currentTarget.value;
      const formatted = core.format(currentValue);
      replaceRange(
        currentValue,
        0,
        currentValue.length,
        formatted,
        Math.min(event.currentTarget.selectionStart, formatted.length),
      );
      return;
    }

    if (completionState) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        moveSelection(1);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        moveSelection(-1);
      } else if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        const selected = completionState.completions[completionState.selectedIndex];
        if (selected) applyCompletion(selected);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        closeCompletions();
      }
      return;
    }

    // Tab은 설정 폼의 포커스 이동으로 남겨두고(키보드 함정 방지), Enter만 들여쓰기를 돕는다
    if (event.key === 'Enter') {
      event.preventDefault();
      insertNewlineWithIndent(event.currentTarget);
    }
  }

  /** 브라우저 기본 Enter 대신 현재 줄 들여쓰기를 유지한다.
   *  `{`와 `}` 사이처럼 괄호 쌍 한가운데라면 VS Code처럼
   *  들여쓴 빈 줄 + 닫는 괄호 줄로 확장하고 커서를 빈 줄에 둔다 */
  function insertNewlineWithIndent(textarea: HTMLTextAreaElement): void {
    const currentValue = textarea.value;
    const { selectionStart, selectionEnd } = textarea;
    const lineStart = currentValue.lastIndexOf('\n', selectionStart - 1) + 1;
    const indentMatch = /^[ \t]*/.exec(currentValue.slice(lineStart, selectionStart));
    const currentIndent = indentMatch ? indentMatch[0] : '';
    const characterBefore = currentValue.slice(selectionStart - 1, selectionStart);
    const characterAfter = currentValue.slice(selectionEnd, selectionEnd + 1);
    const opensBlock = characterBefore === '{' || characterBefore === '[';
    const closesPair =
      (characterBefore === '{' && characterAfter === '}') ||
      (characterBefore === '[' && characterAfter === ']');

    const innerIndent = opensBlock ? `${currentIndent}  ` : currentIndent;
    const inserted = closesPair ? `\n${innerIndent}\n${currentIndent}` : `\n${innerIndent}`;
    replaceRange(
      currentValue,
      selectionStart,
      selectionEnd,
      inserted,
      selectionStart + 1 + innerIndent.length,
    );
  }

  function replaceRange(
    currentValue: string,
    start: number,
    end: number,
    inserted: string,
    caretOffset: number,
  ): void {
    const nextValue = currentValue.slice(0, start) + inserted + currentValue.slice(end);
    pendingSelectionRef.current = { start: caretOffset, end: caretOffset };
    onChange(nextValue);
    onCaretChange(caretOffset);
  }

  const highlightSegments = buildHighlightSegments(value, diagnostics);

  return (
    <div class="relative">
      <div
        ref={backdropRef}
        aria-hidden
        class={`${EDITOR_TEXT_CLASS} pointer-events-none absolute inset-0 overflow-hidden text-transparent`}
      >
        {highlightSegments.map((segment, index) =>
          segment.severity ? (
            <mark
              key={index}
              class={`rounded-sm text-transparent underline ${HIGHLIGHT_CLASSES[segment.severity]}`}
            >
              {segment.text}
            </mark>
          ) : (
            segment.text
          ),
        )}
        {/* 마지막 줄이 빈 줄일 때 textarea와 높이를 맞추기 위한 여분 줄바꿈 */}
        {'\n'}
      </div>
      <textarea
        ref={textareaRef}
        value={value}
        spellcheck={false}
        aria-labelledby="request-body-label"
        placeholder={'{ "reasoning_effort": "max" }'}
        class={`${EDITOR_TEXT_CLASS} relative z-10 block h-40 w-full resize-none border-0 bg-transparent text-ui-content caret-ui-content outline-none placeholder:text-ui-muted/60`}
        onInput={(event) =>
          handleInput(event.currentTarget.value, event.currentTarget.selectionStart)
        }
        onKeyDown={handleKeyDown}
        onKeyUp={(event) => onCaretChange(event.currentTarget.selectionStart)}
        onClick={(event) => {
          onCaretChange(event.currentTarget.selectionStart);
          closeCompletions();
        }}
        onScroll={(event) => {
          const backdrop = backdropRef.current;
          if (!backdrop) return;
          backdrop.scrollTop = event.currentTarget.scrollTop;
          backdrop.scrollLeft = event.currentTarget.scrollLeft;
        }}
        onBlur={(event) => {
          closeCompletions();
          onCommit(event.currentTarget.value);
        }}
      />
      {completionState && (
        <CompletionPopup
          completions={completionState.completions}
          selectedIndex={completionState.selectedIndex}
          position={completionState.anchor}
          onPick={applyCompletion}
        />
      )}
    </div>
  );
}

function stripQuotes(text: string): string {
  return text.replaceAll('"', '');
}

/** 치환 시작점부터 커서까지 이미 타이핑된 prefix로 후보를 거른다 */
function filterCompletions(
  completions: JsonCompletion[],
  text: string,
  offset: number,
): JsonCompletion[] {
  return completions.filter((completion) => {
    const typedPrefix = stripQuotes(text.slice(completion.replaceStart, offset)).toLowerCase();
    return stripQuotes(completion.filterText).toLowerCase().startsWith(typedPrefix);
  });
}

/** 팝업을 새로 열 만한 입력인지 판단한다.
 *  키 입력은 글자·따옴표에서, 값 입력은 콜론(및 콜론 뒤 공백)에서 연다.
 *  들여쓰기 공백이나 괄호는 열지 않는다 — Enter 연타 함정을 피하기 위함 */
function shouldOpenCompletion(
  insertedCharacter: string,
  nextValue: string,
  caretOffset: number,
): boolean {
  if (/[\w"]/.test(insertedCharacter) || insertedCharacter === ':') return true;
  if (insertedCharacter === ' ') {
    return nextValue.slice(caretOffset - 2, caretOffset - 1) === ':';
  }
  return false;
}

interface HighlightSegment {
  text: string;
  severity: 'error' | 'warning' | null;
}

/** 진단 range들을 겹침 없이 정렬해 텍스트를 하이라이트 조각으로 자른다 */
function buildHighlightSegments(text: string, diagnostics: JsonDiagnostic[]): HighlightSegment[] {
  const sortedRanges = [...diagnostics].sort((a, b) => a.range.start.offset - b.range.start.offset);
  const segments: HighlightSegment[] = [];
  let cursor = 0;
  for (const diagnostic of sortedRanges) {
    const start = Math.max(diagnostic.range.start.offset, cursor);
    const end = Math.min(Math.max(diagnostic.range.end.offset, start), text.length);
    if (end <= start) continue;
    if (start > cursor) segments.push({ text: text.slice(cursor, start), severity: null });
    segments.push({ text: text.slice(start, end), severity: diagnostic.severity });
    cursor = end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), severity: null });
  return segments;
}
