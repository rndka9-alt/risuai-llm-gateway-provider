import { KeyRound } from 'lucide-preact';
import { useState } from 'preact/hooks';
import { resolveModelDisplayLabel } from '../../../../options';
import { useSettingsSnapshot } from '../../../utils/settings-snapshot';
import { ApiKeyField } from './ApiKeyField';

// 테마에 따라 muted가 너무 옅어지고, 테두리 있는 칩은 경계가 늘어 소음이 된다 —
// 담백한 텍스트 + 본문색 반투명으로 대비를 확보한다 (볼드는 모델명 하나만)
const STATUS_CHIP_CLASS = 'shrink-0 text-xs leading-none text-ui-content/70';

export function SettingsStatusBar() {
  const { apiKey, model, serviceTier, streamingMode } = useSettingsSnapshot();
  const [editingApiKey, setEditingApiKey] = useState(apiKey.trim() === '');

  return (
    // 스크롤 시 상단에 고정한다. 스크롤 컨테이너의 상단 패딩(pt-5)을 바가 소유해
    // 지나가는 콘텐츠가 바 위로 빼꼼하지 않게 하고, 경계선 대신 아래 12px(gap) 구간을
    // 그라데이션(0~70% 패널색, 70~100% 투명)으로 덮어 부드럽게 사라지게 한다
    <div id="settings-status-bar" class="sticky top-0 z-10 shrink-0 bg-ui-panel pt-5">
      <div class="relative h-[38px]">
        <div class="flex h-full min-w-0 items-center gap-1.5">
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
            class={`flex min-w-0 flex-1 items-center gap-1.5 transition-opacity duration-200 ease-out motion-reduce:transition-none motion-reduce:delay-0 ${editingApiKey ? 'pointer-events-none opacity-0 delay-0' : 'opacity-100 delay-100'}`}
          >
            {streamingMode === 'decoupled' && (
              <span id="status-streaming-chip" class={STATUS_CHIP_CLASS}>
                실시간
              </span>
            )}
            {serviceTier === 'flex' && (
              <span id="status-flex-chip" class={STATUS_CHIP_CLASS}>
                flex
              </span>
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
