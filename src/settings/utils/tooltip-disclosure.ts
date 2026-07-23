import type { TargetedFocusEvent, TargetedKeyboardEvent } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

export function useTooltipDisclosure<
  RootElement extends HTMLElement,
  TriggerElement extends HTMLElement,
>() {
  const rootRef = useRef<RootElement>(null);
  const triggerRef = useRef<TriggerElement>(null);
  const [expanded, setExpanded] = useState(false);

  const closeTooltip = (): void => {
    triggerRef.current?.blur();
    setExpanded(false);
  };

  useEffect(() => {
    if (!expanded) return;

    // iOS Safari는 탭한 button에 focus를 남기지 않을 수 있어 CSS focus-within만으로는
    // 열린 상태와 바깥 탭 닫기를 표현할 수 없다.
    const closeOnOutsidePointer = (event: PointerEvent): void => {
      const target = event.target;
      if (target instanceof Node && rootRef.current?.contains(target)) return;
      closeTooltip();
    };

    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [expanded]);

  const toggleTooltip = (): void => {
    if (expanded) {
      closeTooltip();
      return;
    }
    setExpanded(true);
  };

  const closeOnFocusOut = (event: TargetedFocusEvent<RootElement>): void => {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    setExpanded(false);
  };

  const closeOnEscape = (event: TargetedKeyboardEvent<RootElement>): void => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    closeTooltip();
  };

  return {
    closeOnEscape,
    closeOnFocusOut,
    expanded,
    rootRef,
    toggleTooltip,
    triggerRef,
  };
}
