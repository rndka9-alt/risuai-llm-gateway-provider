import { HelpTooltip } from './HelpTooltip';
import { ToggleControl } from './ToggleControl';
import { FIELD_CAPTION_CLASS, FIELD_CLASS } from '../../constants';
import { persistSetting } from '../../../utils/persistence';
import { updateSettingsSnapshot, useSettingsSnapshot } from '../../../utils/settings-snapshot';
import { saveStreamingMode } from '../../../utils/storage';

export function StreamingModeField() {
  const { streamingMode } = useSettingsSnapshot();

  return (
    <div class={FIELD_CLASS}>
      <span class="flex min-h-4 items-center gap-1">
        <span class={FIELD_CAPTION_CLASS}>응답 방식</span>
        <HelpTooltip id="streaming-mode-tooltip" label="응답 방식 도움말">
          응답 데이터를 조각 단위로 실시간 수신합니다. 플러그인이 모두 조립한 뒤 RisuAI에 한 번에
          전달합니다.
        </HelpTooltip>
      </span>
      <ToggleControl
        id="streaming-mode"
        ariaLabel="응답 방식"
        checked={streamingMode === 'decoupled'}
        label={streamingMode === 'decoupled' ? '스트리밍 연결 · 완료 후 표시' : '일반 요청'}
        onChange={(checked) => {
          const nextStreamingMode = checked ? 'decoupled' : 'off';
          updateSettingsSnapshot({ streamingMode: nextStreamingMode });
          persistSetting(() => saveStreamingMode(nextStreamingMode));
        }}
      />
    </div>
  );
}
