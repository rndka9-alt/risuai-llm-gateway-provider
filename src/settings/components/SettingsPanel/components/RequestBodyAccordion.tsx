import { useMemo, useState } from 'preact/hooks';
import {
  createJsonEditorCore,
  gpt56ChatCompletionsRequestSchema,
  gpt56ExcludedKeyMessages,
} from '../../../../json-editor';
import { useSettingsSnapshot } from '../../../utils/settings-snapshot';
import { RequestBodyField } from './RequestBodyField/RequestBodyField';
import { SettingsAccordion } from './SettingsAccordion';

export function RequestBodyAccordion() {
  const { extraBody } = useSettingsSnapshot();
  const [expanded, setExpanded] = useState(false);

  // 접힌 헤더의 상태 점까지 진단이 필요하므로 코어와 분석을 아코디언 레벨에서 소유한다
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
  // 상태 점: 없음(빈 초안·빈 객체) / 빨강(에러) / 노랑(워닝) / 초록(정상 적용 중)
  const indicatorClass = useMemo(() => {
    if (isDraftEmpty(extraBody)) return undefined;
    if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) return 'bg-ui-loss';
    if (diagnostics.length > 0) return 'bg-ui-warn';
    return 'bg-ui-gain';
  }, [extraBody, diagnostics]);

  return (
    <SettingsAccordion
      id="request-body-settings"
      title="커스텀 요청 body"
      indicatorClass={indicatorClass}
      expanded={expanded}
      onToggle={() => setExpanded((currentExpanded) => !currentExpanded)}
    >
      <RequestBodyField core={core} diagnostics={diagnostics} />
    </SettingsAccordion>
  );
}

function isDraftEmpty(draft: string): boolean {
  const trimmed = draft.trim();
  if (trimmed === '') return true;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return (
      typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      Object.keys(parsed).length === 0
    );
  } catch {
    // 파싱 불가한 초안은 '비어있음'이 아니라 에러 상태로 이어진다
    return false;
  }
}
