import type { ConfigurableLlmFlagName } from '../../../../options';
import { FIELD_CAPTION_CLASS, FIELD_CLASS } from '../../constants';

interface FlagOption {
  label: string;
  name: ConfigurableLlmFlagName;
}

const FLAG_OPTIONS: readonly FlagOption[] = [
  { label: 'Full System Prompt', name: 'hasFullSystemPrompt' },
  { label: 'First System Prompt', name: 'hasFirstSystemPrompt' },
  { label: 'Alternate Role', name: 'requiresAlternateRole' },
  { label: 'Must Start With User', name: 'mustStartWithUserInput' },
  { label: 'Pool Supported', name: 'poolSupported' },
];

interface LlmFlagsFieldProps {
  flagNames: readonly ConfigurableLlmFlagName[];
  onChange: (flagName: ConfigurableLlmFlagName, checked: boolean) => void;
}

export function LlmFlagsField({ flagNames, onChange }: LlmFlagsFieldProps) {
  return (
    <div class={FIELD_CLASS}>
      <span id="llm-flags-label" class={FIELD_CAPTION_CLASS}>
        LLM flags
      </span>
      <fieldset
        aria-labelledby="llm-flags-label"
        class="m-0 grid grid-cols-2 gap-x-2.5 gap-y-2 border-0 p-0"
      >
        {FLAG_OPTIONS.map((option) => (
          <label
            key={option.name}
            class="flex min-w-0 items-center gap-[7px] text-xs text-ui-content"
          >
            <input
              id={`flag-${option.name}`}
              type="checkbox"
              checked={flagNames.includes(option.name)}
              onChange={(event) => onChange(option.name, event.currentTarget.checked)}
              class="m-0 size-4 shrink-0 accent-ui-accent"
            />
            <span class="truncate">{option.label}</span>
          </label>
        ))}
        {/* convert.ts가 미디어를 보존할 때까지 대표 항목만 비활성 노출한다. */}
        <label class="flex min-w-0 items-center gap-[7px] text-xs text-ui-muted opacity-70">
          <input type="checkbox" disabled class="m-0 size-4 shrink-0" />
          <span class="truncate">Image Input · 미지원</span>
        </label>
      </fieldset>
    </div>
  );
}
