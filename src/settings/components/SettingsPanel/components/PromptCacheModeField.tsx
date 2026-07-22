import { resolvePromptCacheMode } from '../../../../cache';
import { HelpTooltip } from './HelpTooltip';
import { FIELD_CAPTION_CLASS, FIELD_CLASS, SELECT_CLASS } from '../../constants';
import { persistSetting } from '../../../utils/persistence';
import { updateSettingsSnapshot, useSettingsSnapshot } from '../../../utils/settings-snapshot';
import { savePromptCacheMode } from '../../../utils/storage';

export function PromptCacheModeField() {
  const { promptCacheMode } = useSettingsSnapshot();

  return (
    <div class={FIELD_CLASS}>
      <span class="flex min-h-4 items-center gap-1">
        <label class={`${FIELD_CAPTION_CLASS} text-ui-accent`} htmlFor="prompt-cache-mode">
          캐시 모드
        </label>
        <HelpTooltip id="prompt-cache-mode-tooltip" label="캐시 모드 도움말">
          캐시를 끄면 implicit으로 바뀌지 않고 explicit 모드를 유지해요. 캐시 지점은 보내지 않아
          추가 캐시 저장 비용도 발생하지 않아요.
        </HelpTooltip>
      </span>
      <select
        id="prompt-cache-mode"
        aria-label="프롬프트 캐시 모드"
        value={promptCacheMode}
        onChange={(event) => {
          const nextPromptCacheMode = resolvePromptCacheMode(event.currentTarget.value);
          updateSettingsSnapshot({ promptCacheMode: nextPromptCacheMode });
          persistSetting(() => savePromptCacheMode(nextPromptCacheMode));
        }}
        class={`${SELECT_CLASS} border-ui-accent bg-ui-accent-soft font-semibold`}
      >
        <option value="explicit">명시적 캐시 사용</option>
        <option value="disabled">캐시 끄기</option>
      </select>
    </div>
  );
}
