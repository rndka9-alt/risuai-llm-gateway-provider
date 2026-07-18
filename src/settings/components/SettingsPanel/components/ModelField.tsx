import { FIELD_CAPTION_CLASS, FIELD_CLASS, SELECT_CLASS } from '../../constants';

interface ModelFieldProps {
  model: string;
  modelOptions: readonly string[];
  onChange: (model: string) => void;
}

export function ModelField({ model, modelOptions, onChange }: ModelFieldProps) {
  return (
    <div class={FIELD_CLASS}>
      <label class={FIELD_CAPTION_CLASS} htmlFor="model">
        모델
      </label>
      <select
        id="model"
        aria-label="모델"
        value={model}
        onChange={(event) => onChange(event.currentTarget.value)}
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
