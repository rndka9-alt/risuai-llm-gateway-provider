import { CONFIGURABLE_LLM_FLAG_NAMES, type ConfigurableLlmFlagName } from '../../../../options';
import { FIELD_CAPTION_CLASS, FIELD_CLASS } from '../../constants';
import { persistSetting } from '../../../utils/persistence';
import { createProviderRegistrationSignature } from '../../../utils/registration';
import { setSettingsReloadNeeded } from '../../../utils/signals';
import { updateSettingsSnapshot, useSettingsSnapshot } from '../../../utils/settings-snapshot';
import { saveConfigurableLlmFlagNames } from '../../../utils/storage';

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

export function LlmFlagsField() {
  const { flagNames, registrationSignature } = useSettingsSnapshot();

  const updateFlag = (flagName: ConfigurableLlmFlagName, checked: boolean): void => {
    const selectedFlagNames = new Set(flagNames);
    if (checked) selectedFlagNames.add(flagName);
    else selectedFlagNames.delete(flagName);
    const nextFlagNames = CONFIGURABLE_LLM_FLAG_NAMES.filter((candidate) =>
      selectedFlagNames.has(candidate),
    );
    updateSettingsSnapshot({ flagNames: nextFlagNames });
    setSettingsReloadNeeded(
      createProviderRegistrationSignature({ flagNames: nextFlagNames }) !== registrationSignature,
    );
    persistSetting(() => saveConfigurableLlmFlagNames(nextFlagNames));
  };

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
              onChange={(event) => updateFlag(option.name, event.currentTarget.checked)}
              class="m-0 size-4 shrink-0 accent-ui-accent"
            />
            <span class="truncate">{option.label}</span>
          </label>
        ))}
      </fieldset>
    </div>
  );
}
