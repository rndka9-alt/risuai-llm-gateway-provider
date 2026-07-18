import { VERBOSITY_OPTIONS, type Verbosity } from '../../../../options';
import { SteppedSlider, type SteppedSliderOption } from '../../SteppedSlider';
import { persistSetting } from '../../../utils/persistence';
import { updateSettingsSnapshot, useSettingsSnapshot } from '../../../utils/settings-snapshot';
import { saveVerbosity } from '../../../utils/storage';

const VERBOSITY_SLIDER_OPTIONS: readonly SteppedSliderOption<Verbosity>[] = [
  { label: '지정 안 함', value: undefined },
  ...VERBOSITY_OPTIONS.map((value) => ({ label: value, value })),
];

export function VerbosityField() {
  const { verbosity } = useSettingsSnapshot();

  return (
    <SteppedSlider
      id="verbosity"
      ariaLabel="Verbosity"
      label="Verbosity"
      value={verbosity}
      options={VERBOSITY_SLIDER_OPTIONS}
      onInput={(nextVerbosity) => {
        updateSettingsSnapshot({ verbosity: nextVerbosity });
        persistSetting(() => saveVerbosity(nextVerbosity));
      }}
    />
  );
}
