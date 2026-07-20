import { useMemo, useRef, useState } from 'preact/hooks';
import {
  createJsonEditorCore,
  gpt56ChatCompletionsRequestSchema,
  gpt56ExcludedKeyMessages,
} from '../../../../../json-editor';
import { FIELD_CAPTION_CLASS, FIELD_CLASS } from '../../../constants';
import { persistSetting } from '../../../../utils/persistence';
import { updateSettingsSnapshot, useSettingsSnapshot } from '../../../../utils/settings-snapshot';
import { saveExtraBody } from '../../../../utils/storage';
import { HelpTooltip } from '../HelpTooltip';
import { EditorBreadcrumb } from './components/EditorBreadcrumb';
import { EditorDiagnostics } from './components/EditorDiagnostics';
import { JsonEditorArea } from './components/JsonEditorArea';
import type { JsonEditorApi } from './components/JsonEditorArea';

const PERSIST_DEBOUNCE_MS = 600;

export function RequestBodyField() {
  const { extraBody } = useSettingsSnapshot();
  const [caretOffset, setCaretOffset] = useState(0);
  const editorApiRef = useRef<JsonEditorApi | null>(null);
  const persistTimerRef = useRef<number | undefined>(undefined);

  const core = useMemo(
    () =>
      createJsonEditorCore({
        schema: gpt56ChatCompletionsRequestSchema,
        unrecognizedKeyMessages: gpt56ExcludedKeyMessages,
      }),
    [],
  );
  // 빈 초안은 기능이 꺼진 상태이므로 진단하지 않는다
  const diagnostics = useMemo(
    () => (extraBody.trim() === '' ? [] : core.analyze(extraBody).diagnostics),
    [core, extraBody],
  );
  const breadcrumbSegments = useMemo(
    () => core.breadcrumbAt(extraBody, caretOffset),
    [core, extraBody, caretOffset],
  );

  const persistDraft = (draft: string): void => {
    if (persistTimerRef.current !== undefined) window.clearTimeout(persistTimerRef.current);
    persistTimerRef.current = undefined;
    persistSetting(() => saveExtraBody(draft));
  };

  const updateDraft = (draft: string): void => {
    updateSettingsSnapshot({ extraBody: draft });
    // 키 입력마다 pluginStorage에 쓰면 과해서 잠깐 모아 저장하고, blur에서 확정한다
    if (persistTimerRef.current !== undefined) window.clearTimeout(persistTimerRef.current);
    persistTimerRef.current = window.setTimeout(() => persistDraft(draft), PERSIST_DEBOUNCE_MS);
  };

  // 닫는(blur) 시점에 유효한 JSON이면 정렬해서 저장한다 — invalid 초안은 원문 그대로 보존.
  // 타이핑 중에는 건드리지 않으므로, 다시 열 때는 항상 정렬된 상태로 시작한다
  const commitDraft = (draft: string): void => {
    const finalDraft = isValidJson(draft) ? core.format(draft) : draft;
    if (finalDraft !== draft) updateSettingsSnapshot({ extraBody: finalDraft });
    persistDraft(finalDraft);
  };

  return (
    <div class={FIELD_CLASS}>
      <span id="request-body-label" class={`${FIELD_CAPTION_CLASS} flex items-center gap-1`}>
        커스텀 요청 body (JSON)
        <HelpTooltip id="request-body-help" label="커스텀 요청 body 도움말">
          요청 직전 body에 deep merge되고, 겹치는 필드는 이 값이 덮어써요. JSON이 유효하지 않으면 그
          요청에서는 통째로 무시돼요. 자동완성·검증은 GPT-5.6 × Gateway 계약 기준이에요.
        </HelpTooltip>
      </span>
      {/* 완성 팝업이 에디터 상자 밖으로 나갈 수 있어야 하므로 overflow를 자르지 않는다 */}
      <div class="rounded-lg border border-ui-frame bg-ui-control focus-within:border-ui-accent">
        <EditorBreadcrumb segments={breadcrumbSegments} />
        <JsonEditorArea
          value={extraBody}
          diagnostics={diagnostics}
          core={core}
          apiRef={editorApiRef}
          onChange={updateDraft}
          onCaretChange={setCaretOffset}
          onCommit={commitDraft}
        />
      </div>
      <EditorDiagnostics
        diagnostics={diagnostics}
        onSelect={(diagnostic) =>
          editorApiRef.current?.focusRange(
            diagnostic.range.start.offset,
            diagnostic.range.end.offset,
          )
        }
      />
    </div>
  );
}

function isValidJson(text: string): boolean {
  if (text.trim() === '') return false;
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}
