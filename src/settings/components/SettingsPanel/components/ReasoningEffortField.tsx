import { REASONING_EFFORT_OPTIONS, type ReasoningEffort } from '../../../../options';
import { SteppedSlider, type SteppedSliderOption } from '../../SteppedSlider';
import { persistSetting } from '../../../utils/persistence';
import { updateSettingsSnapshot, useSettingsSnapshot } from '../../../utils/settings-snapshot';
import { saveReasoningEffort } from '../../../utils/storage';

const REASONING_EFFORT_SLIDER_OPTIONS: readonly SteppedSliderOption<ReasoningEffort>[] = [
  { label: '지정 안 함', value: undefined },
  ...REASONING_EFFORT_OPTIONS.map((value) => ({ label: value, value })),
];

export function ReasoningEffortField() {
  const { reasoningEffort } = useSettingsSnapshot();

  return (
    <SteppedSlider
      id="reasoning-effort"
      ariaLabel="Reasoning effort"
      label="Reasoning effort"
      value={reasoningEffort}
      options={REASONING_EFFORT_SLIDER_OPTIONS}
      onInput={(nextReasoningEffort) => {
        updateSettingsSnapshot({ reasoningEffort: nextReasoningEffort });
        persistSetting(() => saveReasoningEffort(nextReasoningEffort));
      }}
    />
  );
}
