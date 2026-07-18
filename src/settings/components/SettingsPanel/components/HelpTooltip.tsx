import type { ComponentChildren } from 'preact';

interface HelpTooltipProps {
  children: ComponentChildren;
  id: string;
  label: string;
}

export function HelpTooltip({ children, id, label }: HelpTooltipProps) {
  return (
    <span class="group relative inline-flex items-center">
      <button
        type="button"
        aria-label={label}
        aria-describedby={id}
        class="grid size-4 cursor-help place-items-center rounded-full border-0 bg-transparent p-0 text-[11px] leading-none text-ui-muted hover:text-ui-content focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ui-accent"
      >
        <span aria-hidden="true">ⓘ</span>
      </button>
      <span
        id={id}
        role="tooltip"
        class="pointer-events-none invisible absolute top-[calc(100%+7px)] left-[-4px] z-30 w-[min(250px,calc(100vw-64px))] -translate-y-1 rounded-lg border border-ui-on-popover/20 bg-ui-popover px-[11px] py-2.5 text-[11px] leading-[1.45] font-normal tracking-normal text-ui-on-popover opacity-0 shadow-xl transition duration-150 group-focus-within:pointer-events-auto group-focus-within:visible group-focus-within:translate-y-0 group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:visible group-hover:translate-y-0 group-hover:opacity-100"
      >
        {children}
      </span>
    </span>
  );
}
