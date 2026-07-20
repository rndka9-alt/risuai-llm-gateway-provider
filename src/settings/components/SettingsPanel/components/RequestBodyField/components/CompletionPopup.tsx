import type { JsonCompletion } from '../../../../../../json-editor';

interface CompletionPopupProps {
  completions: JsonCompletion[];
  selectedIndex: number;
  position: { top: number; left: number };
  onPick(completion: JsonCompletion): void;
}

export function CompletionPopup({
  completions,
  selectedIndex,
  position,
  onPick,
}: CompletionPopupProps) {
  return (
    <ul
      class="absolute z-20 m-0 max-h-40 w-64 list-none overflow-y-auto rounded-lg border border-ui-frame bg-ui-panel p-0 py-1 shadow-xl"
      style={{ top: position.top, left: position.left }}
    >
      {completions.map((completion, index) => {
        const isSelected = index === selectedIndex;
        return (
          <li
            key={`${completion.label}-${index}`}
            ref={(element) => {
              if (isSelected) element?.scrollIntoView({ block: 'nearest' });
            }}
          >
            <button
              type="button"
              class={`flex w-full cursor-pointer items-center gap-1.5 border-0 px-2 py-0.5 text-left text-[11px] ${
                isSelected
                  ? 'bg-ui-accent-soft text-ui-content'
                  : 'bg-transparent text-ui-content/85'
              }`}
              // mousedown에서 preventDefault해야 textarea가 포커스를 잃지 않는다
              onMouseDown={(event) => {
                event.preventDefault();
                onPick(completion);
              }}
            >
              <span
                class={`w-3.5 shrink-0 text-center font-semibold ${
                  completion.kind === 'property' ? 'text-ui-accent' : 'text-ui-warn'
                }`}
              >
                {completion.kind === 'property' ? 'K' : 'V'}
              </span>
              <span class="truncate font-mono">{completion.label}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
