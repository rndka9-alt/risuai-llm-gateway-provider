import { Info } from 'lucide-preact';
import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';

interface HelpTooltipProps {
  children: ComponentChildren;
  id: string;
  label: string;
}

/** 아이콘 왼쪽 기준의 시각적 기본 오프셋 */
const BASE_LEFT_PX = -4;
/** 패널 가장자리와 툴팁 사이 최소 여백 */
const PANEL_GUTTER_PX = 12;

export function HelpTooltip({ children, id, label }: HelpTooltipProps) {
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const [shiftX, setShiftX] = useState(0);

  // invisible 상태의 absolute 요소도 scrollable overflow에는 기여하므로, hover 시점이
  // 아니라 마운트 시점부터 패널(main) 오른쪽을 넘는 만큼 왼쪽으로 당겨 고정해 둔다
  useLayoutEffect(() => {
    const clampIntoPanel = (): void => {
      const tooltip = tooltipRef.current;
      const anchor = tooltip?.parentElement;
      const panel = tooltip?.closest('main');
      if (!tooltip || !anchor || !panel) return;

      const anchorRect = anchor.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const overflowRight =
        anchorRect.left + BASE_LEFT_PX + tooltip.offsetWidth - (panelRect.right - PANEL_GUTTER_PX);
      // 왼쪽으로 당기되, 패널 왼쪽 여백을 뚫고 나가지는 않게 한다
      const maxShift = anchorRect.left + BASE_LEFT_PX - (panelRect.left + PANEL_GUTTER_PX);
      setShiftX(Math.min(Math.max(0, overflowRight), Math.max(0, maxShift)));
    };

    clampIntoPanel();
    window.addEventListener('resize', clampIntoPanel);
    return () => window.removeEventListener('resize', clampIntoPanel);
  }, []);

  return (
    <span class="group relative inline-flex items-center">
      <button
        type="button"
        aria-label={label}
        aria-describedby={id}
        class="grid size-4 cursor-help place-items-center rounded-full border-0 bg-transparent p-0 text-[11px] leading-none text-ui-muted hover:text-ui-content focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ui-accent"
      >
        <Info size={14} strokeWidth={1.7} aria-hidden="true" />
      </button>
      <span
        id={id}
        role="tooltip"
        ref={tooltipRef}
        style={{ left: BASE_LEFT_PX - shiftX }}
        class="pointer-events-none invisible absolute top-[calc(100%+7px)] z-30 w-[min(250px,calc(100vw-64px))] -translate-y-1 rounded-lg border border-ui-on-popover/20 bg-ui-popover px-[11px] py-2.5 text-[11px] leading-[1.45] font-normal tracking-normal text-ui-on-popover opacity-0 shadow-xl transition duration-150 group-focus-within:pointer-events-auto group-focus-within:visible group-focus-within:translate-y-0 group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:visible group-hover:translate-y-0 group-hover:opacity-100"
      >
        {children}
      </span>
    </span>
  );
}
