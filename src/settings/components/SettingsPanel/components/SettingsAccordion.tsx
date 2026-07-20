import { ChevronDown } from 'lucide-preact';
import type { ComponentChildren } from 'preact';
import { FIELD_CAPTION_CLASS } from '../../constants';

interface SettingsAccordionProps {
  children: ComponentChildren;
  expanded: boolean;
  id: string;
  /** 헤더 상태 점의 색상 클래스 — 없으면 점을 그리지 않는다 */
  indicatorClass?: string;
  onToggle: () => void;
  title: string;
}

export function SettingsAccordion({
  children,
  expanded,
  id,
  indicatorClass,
  onToggle,
  title,
}: SettingsAccordionProps) {
  return (
    <section class="min-w-0">
      <button
        id={`${id}-toggle`}
        type="button"
        aria-controls={`${id}-content`}
        aria-expanded={expanded}
        onClick={onToggle}
        class="flex min-h-[34px] w-full cursor-pointer items-center justify-between gap-2 border-0 bg-transparent px-0 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-accent"
      >
        {/* 제목은 필드 캡션과 같은 위계로 통일한다 (볼드는 상태바 모델명 하나만) */}
        <span class={`flex min-w-0 items-center gap-1.5 ${FIELD_CAPTION_CLASS}`}>
          <span class="truncate">{title}</span>
          {indicatorClass !== undefined && (
            <span
              id={`${id}-indicator`}
              class={`size-1.5 shrink-0 rounded-full ${indicatorClass}`}
            />
          )}
        </span>
        {/* 좌측 chevron은 줄머리를 들쭉이게 해서, 상태바 모델명처럼 우측 끝에 ∨/∧로 둔다 */}
        <ChevronDown
          size={14}
          strokeWidth={1.7}
          aria-hidden="true"
          class={`shrink-0 text-ui-muted transition-transform duration-150 motion-reduce:transition-none ${expanded ? 'rotate-180' : 'rotate-0'}`}
        />
      </button>
      {/* auto 높이를 직접 보간할 수 없어 0fr↔1fr로 실제 콘텐츠 높이를 150ms 동안 보간한다. */}
      <div
        id={`${id}-content`}
        aria-hidden={!expanded}
        inert={!expanded}
        class={`grid transition-[grid-template-rows,opacity] duration-150 ease-out motion-reduce:transition-none ${expanded ? 'grid-rows-[1fr] opacity-100' : 'pointer-events-none grid-rows-[0fr] opacity-0'}`}
      >
        <div class="min-h-0 overflow-hidden">
          <div class="flex flex-col gap-3 pt-2 pb-1">{children}</div>
        </div>
      </div>
    </section>
  );
}
