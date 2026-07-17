export const FIELD_CLASS =
  'flex min-w-0 flex-col gap-1.5';
export const FIELD_CAPTION_CLASS =
  'text-[11px] font-medium leading-tight tracking-[0.01em] text-ui-muted';

export interface SteppedSliderOption<Value extends string> {
  label: string;
  value: Value | undefined;
}

interface SteppedSliderProps<Value extends string> {
  ariaLabel: string;
  id: string;
  label: string;
  onInput: (value: Value | undefined) => void;
  options: readonly SteppedSliderOption<Value>[];
  value: Value | undefined;
}

export function SteppedSlider<Value extends string>({
  ariaLabel,
  id,
  label,
  onInput,
  options,
  value,
}: SteppedSliderProps<Value>) {
  if (options.length < 2) {
    throw new Error(`Stepped slider #${id} requires at least two options`);
  }

  const selectedIndex = options.findIndex((option) => option.value === value);
  const selectedOption = options[selectedIndex];
  if (selectedIndex === -1 || selectedOption === undefined) {
    throw new Error(`Stepped slider #${id} received an unknown value`);
  }

  const isUnset = selectedOption.value === undefined;
  const progressRatio = selectedIndex / (options.length - 1);
  const progressPercentage = progressRatio * 100;
  const thumbOffsetPixels = 12 * (1 - (2 * progressRatio));

  return (
    <div class={FIELD_CLASS}>
      <span class="flex min-h-4 items-center justify-between gap-2">
        <label class={FIELD_CAPTION_CLASS} htmlFor={id}>{label}</label>
        <span
          id={`${id}-value`}
          class={`${FIELD_CAPTION_CLASS} ${isUnset ? 'opacity-60' : 'text-ui-accent'}`}
        >
          {selectedOption.label}
        </span>
      </span>
      <div
        id={`${id}-control`}
        data-unset={isUnset}
        class="stepped-slider-control relative h-[38px] w-full"
        style={`--stepped-slider-progress: ${progressPercentage}%; --stepped-slider-thumb-offset: ${thumbOffsetPixels}px`}
      >
        <div
          id={`${id}-track`}
          aria-hidden="true"
          class="stepped-slider-track pointer-events-none absolute inset-x-0 top-1/2 h-5 -translate-y-1/2 overflow-hidden rounded-full bg-ui-switch"
        >
          <span
            id={`${id}-fill`}
            class="stepped-slider-fill absolute inset-y-0 left-0 rounded-full bg-blue-600/50 transition-[width,opacity] duration-150 ease-out motion-reduce:transition-none"
          />
          <span class="absolute inset-0 flex items-center justify-between px-3">
            {options.map((option, index) => (
              <span
                key={`${id}-${option.label}`}
                class={`size-1 rounded-full ${!isUnset && index <= selectedIndex ? 'bg-white/45' : 'bg-ui-muted/55'}`}
              />
            ))}
          </span>
        </div>
        <span
          id={`${id}-thumb`}
          aria-hidden="true"
          class="stepped-slider-thumb pointer-events-none absolute top-1/2 z-20 size-6 -translate-x-1/2 -translate-y-1/2 rounded-full"
        />
        <input
          id={id}
          type="range"
          min="0"
          max={options.length - 1}
          step="1"
          value={selectedIndex}
          aria-label={ariaLabel}
          aria-describedby={`${id}-value`}
          aria-valuetext={selectedOption.label}
          data-unset={isUnset}
          onInput={(event) => {
            const nextOption = options[event.currentTarget.valueAsNumber];
            if (nextOption === undefined) {
              throw new Error(`Stepped slider #${id} selected an invalid index`);
            }
            onInput(nextOption.value);
          }}
          class="stepped-slider absolute inset-0 z-10 m-0 h-full w-full"
        />
      </div>
    </div>
  );
}
