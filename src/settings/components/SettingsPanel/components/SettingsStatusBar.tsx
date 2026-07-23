import { ArrowBigDownDash, KeyRound, RadioTower } from 'lucide-preact';
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { resolveModelDisplayLabel } from '../../../../options';
import { useSettingsSnapshot } from '../../../utils/settings-snapshot';
import { useTooltipDisclosure } from '../../../utils/tooltip-disclosure';
import { ApiKeyField } from './ApiKeyField';

interface StatusTooltipChipProps {
  children: ComponentChildren;
  icon: ComponentChildren;
  id: string;
  label: string;
  tooltipId: string;
}

function StatusTooltipChip({ children, icon, id, label, tooltipId }: StatusTooltipChipProps) {
  const { closeOnEscape, closeOnFocusOut, expanded, rootRef, toggleTooltip, triggerRef } =
    useTooltipDisclosure<HTMLSpanElement, HTMLButtonElement>();

  return (
    <span
      ref={rootRef}
      class="group relative inline-flex size-[18px] shrink-0"
      onFocusOut={closeOnFocusOut}
      onKeyDown={closeOnEscape}
    >
      <button
        id={id}
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-describedby={tooltipId}
        aria-expanded={expanded}
        onClick={toggleTooltip}
        class="grid size-[18px] cursor-help place-items-center border-0 bg-transparent p-0 text-ui-content/70 focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-accent"
      >
        {icon}
      </button>
      <span
        id={tooltipId}
        role="tooltip"
        class={`absolute top-[calc(100%+7px)] left-0 z-30 w-max rounded-lg border border-ui-on-popover/20 bg-ui-popover px-[11px] py-2.5 text-xs leading-[1.45] font-normal tracking-normal whitespace-nowrap text-ui-on-popover shadow-xl transition duration-150 group-focus-within:visible group-focus-within:translate-y-0 group-focus-within:opacity-100 group-hover:visible group-hover:translate-y-0 group-hover:opacity-100 ${expanded ? 'visible translate-y-0 opacity-100' : 'pointer-events-none invisible -translate-y-1 opacity-0'}`}
      >
        {children}
      </span>
    </span>
  );
}

export function SettingsStatusBar() {
  const { apiKey, model, serviceTier, streamingMode } = useSettingsSnapshot();
  const [editingApiKey, setEditingApiKey] = useState(apiKey.trim() === '');

  return (
    // 스크롤 시 상단에 고정한다. 스크롤 컨테이너의 상단 패딩(pt-5)을 바가 소유해
    // 지나가는 콘텐츠가 바 위로 빼꼼하지 않게 하고, 경계선 대신 아래 12px(gap) 구간을
    // 그라데이션(0~70% 패널색, 70~100% 투명)으로 덮어 부드럽게 사라지게 한다
    <div id="settings-status-bar" class="sticky top-0 z-10 shrink-0 bg-ui-panel pt-5">
      <div class="relative h-[38px]">
        <div class="flex h-full min-w-0 items-center gap-4">
          <button
            id="api-key-edit"
            type="button"
            aria-label="API 키 수정"
            aria-hidden={editingApiKey}
            disabled={editingApiKey}
            onClick={() => setEditingApiKey(true)}
            class="grid size-[38px] shrink-0 cursor-pointer place-items-center rounded-lg border border-ui-frame bg-ui-control p-0 text-ui-muted hover:text-ui-content focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ui-accent disabled:cursor-default"
          >
            <KeyRound size={18} strokeWidth={1.7} aria-hidden="true" />
          </button>
          <div
            id="settings-status-summary"
            aria-hidden={editingApiKey}
            class={`flex min-w-0 flex-1 items-center gap-4 transition-opacity duration-200 ease-out motion-reduce:transition-none motion-reduce:delay-0 ${editingApiKey ? 'pointer-events-none opacity-0 delay-0' : 'opacity-100 delay-100'}`}
          >
            {streamingMode === 'decoupled' && (
              <StatusTooltipChip
                id="status-streaming-chip"
                label="스트리밍"
                tooltipId="status-streaming-tooltip"
                icon={<RadioTower size={18} strokeWidth={1.7} aria-hidden="true" />}
              >
                스트리밍 연결 · 완료 후 표시
              </StatusTooltipChip>
            )}
            {serviceTier === 'flex' && (
              <StatusTooltipChip
                id="status-flex-chip"
                label="Flex"
                tooltipId="status-flex-tooltip"
                icon={<ArrowBigDownDash size={18} strokeWidth={1.7} aria-hidden="true" />}
              >
                Flex · 반값, 느릴 수 있음
              </StatusTooltipChip>
            )}
            <span
              id="status-model"
              title={model}
              class="ml-auto min-w-0 truncate text-right text-sm font-semibold text-ui-content"
            >
              {resolveModelDisplayLabel(model)}
            </span>
          </div>
        </div>
        {/* 입력을 상태 요약 위에 띄워 width 전환 중에도 칩과 모델의 기준 위치는 고정한다. */}
        <ApiKeyField
          editing={editingApiKey}
          onCommit={(configured) => setEditingApiKey(!configured)}
        />
      </div>
      <div
        aria-hidden
        class="pointer-events-none absolute inset-x-0 top-full h-3 bg-[linear-gradient(to_bottom,var(--color-ui-panel)_0%,var(--color-ui-panel)_70%,transparent_100%)]"
      />
    </div>
  );
}
