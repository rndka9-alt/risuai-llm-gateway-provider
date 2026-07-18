import { resolvePromptCacheMode, type PromptCacheMode } from '../../../../cache';
import { HelpTooltip } from './HelpTooltip';
import { FIELD_CAPTION_CLASS, FIELD_CLASS, SELECT_CLASS } from '../../constants';

interface PromptCacheModeFieldProps {
  onChange: (promptCacheMode: PromptCacheMode) => void;
  promptCacheMode: PromptCacheMode;
}

export function PromptCacheModeField({ onChange, promptCacheMode }: PromptCacheModeFieldProps) {
  return (
    <div class={FIELD_CLASS}>
      <span class="flex min-h-4 items-center gap-1">
        <label class={`${FIELD_CAPTION_CLASS} text-ui-accent`} htmlFor="prompt-cache-mode">
          캐시 모드
        </label>
        <HelpTooltip id="prompt-cache-mode-tooltip" label="캐시 모드 도움말">
          캐시 끄기 시에도 explicit 모드는 유지하고 breakpoint만 생략합니다. implicit 캐시로
          전환되지 않으며, 추가 캐시 쓰기 비용이 발생하지 않습니다.
        </HelpTooltip>
      </span>
      <select
        id="prompt-cache-mode"
        aria-label="프롬프트 캐시 모드"
        value={promptCacheMode}
        onChange={(event) => onChange(resolvePromptCacheMode(event.currentTarget.value))}
        class={`${SELECT_CLASS} border-ui-accent bg-ui-accent-soft font-semibold`}
      >
        <option value="explicit">명시적 캐시 사용</option>
        <option value="disabled">캐시 끄기</option>
      </select>
    </div>
  );
}
