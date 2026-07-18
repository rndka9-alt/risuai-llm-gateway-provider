interface ToggleControlProps {
  ariaLabel: string;
  checked: boolean;
  id: string;
  label: string;
  onChange: (checked: boolean) => void;
}

export function ToggleControl({ ariaLabel, checked, id, label, onChange }: ToggleControlProps) {
  return (
    <label
      htmlFor={id}
      class="flex h-[38px] w-full cursor-pointer items-center justify-between rounded-lg border border-ui-frame bg-ui-control px-3 text-[13px] text-ui-content"
    >
      <span id={`${id}-label`}>{label}</span>
      <span class="relative shrink-0">
        <input
          id={id}
          type="checkbox"
          role="switch"
          aria-label={ariaLabel}
          checked={checked}
          onChange={(event) => onChange(event.currentTarget.checked)}
          class="peer sr-only"
        />
        <span class="relative block h-5 w-[34px] rounded-full bg-ui-switch transition-colors peer-checked:bg-ui-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ui-accent after:absolute after:top-0.5 after:left-0.5 after:size-4 after:rounded-full after:bg-ui-knob after:shadow-sm after:transition-transform after:content-[''] peer-checked:after:translate-x-3.5 peer-checked:after:bg-ui-background" />
      </span>
    </label>
  );
}
