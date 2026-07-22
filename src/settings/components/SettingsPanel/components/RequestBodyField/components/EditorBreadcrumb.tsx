import { Fragment } from 'preact';
import type { BreadcrumbSegment } from '../../../../../../json-editor';

interface EditorBreadcrumbProps {
  segments: BreadcrumbSegment[];
}

export function EditorBreadcrumb({ segments }: EditorBreadcrumbProps) {
  return (
    <nav class="flex h-6 shrink-0 items-center gap-1 overflow-x-auto border-b border-ui-frame/60 px-2.5 font-mono text-xs whitespace-nowrap text-ui-muted">
      <span>$</span>
      {segments.map((segment, index) => (
        <Fragment key={`${index}-${segment.label}`}>
          <span class="opacity-60">›</span>
          <span
            class={
              segment.kind === 'index'
                ? 'text-ui-accent'
                : index === segments.length - 1
                  ? 'text-ui-content'
                  : undefined
            }
          >
            {segment.kind === 'index' ? `[${segment.label}]` : segment.label}
          </span>
        </Fragment>
      ))}
    </nav>
  );
}
