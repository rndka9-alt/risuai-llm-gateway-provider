import { FIELD_CAPTION_CLASS, FIELD_CLASS, SELECT_CLASS } from '../../constants';
import { buildModelOptionList } from '../../../utils/model-options';
import { persistSetting } from '../../../utils/persistence';
import { updateSettingsSnapshot, useSettingsSnapshot } from '../../../utils/settings-snapshot';
import { saveModel } from '../../../utils/storage';

export function ModelField() {
  const { model } = useSettingsSnapshot();
  const modelOptions = buildModelOptionList(model);

  return (
    <div class={FIELD_CLASS}>
      <label class={FIELD_CAPTION_CLASS} htmlFor="model">
        모델
      </label>
      <select
        id="model"
        aria-label="모델"
        value={model}
        onChange={(event) => {
          const nextModel = event.currentTarget.value;
          updateSettingsSnapshot({ model: nextModel });
          persistSetting(() => saveModel(nextModel));
        }}
        class={SELECT_CLASS}
      >
        {modelOptions.map((modelOption) => (
          <option key={modelOption} value={modelOption}>
            {modelOption}
          </option>
        ))}
      </select>
    </div>
  );
}
