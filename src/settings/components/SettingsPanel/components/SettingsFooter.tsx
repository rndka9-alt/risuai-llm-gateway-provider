export interface LedgerDisplay {
  amountText: string;
  tone: 'gain' | 'loss' | 'neutral';
}

const LEDGER_TONE_CLASSES: Record<LedgerDisplay['tone'], string> = {
  gain: 'text-ui-gain',
  loss: 'text-ui-loss',
  neutral: 'text-inherit',
};

interface SettingsFooterProps {
  ledgerDisplay: LedgerDisplay;
  ledgerReadText: string;
  ledgerResetFailed: boolean;
  ledgerResetting: boolean;
  ledgerWriteText: string;
  onClose: () => void;
  onLedgerReset: () => void;
}

export function SettingsFooter({
  ledgerDisplay,
  ledgerReadText,
  ledgerResetFailed,
  ledgerResetting,
  ledgerWriteText,
  onClose,
  onLedgerReset,
}: SettingsFooterProps) {
  return (
    <footer class="sticky bottom-0 z-10 flex min-h-14 items-center justify-between border-t border-ui-frame bg-ui-panel px-4 py-2.5">
      <div class="group relative flex min-w-0 items-center gap-0.5">
        <button
          id="ledger-summary"
          type="button"
          aria-label="캐시 손익 상세"
          aria-describedby="ledger-popover"
          class="flex min-w-0 cursor-help items-center gap-1.5 border-0 bg-transparent py-1 pr-0.5 pl-0 text-[11px] text-ui-muted hover:text-ui-content focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-accent"
        >
          <span
            id="ledger-amount-summary"
            class={`text-[12.5px] font-semibold tabular-nums ${LEDGER_TONE_CLASSES[ledgerDisplay.tone]}`}
          >
            {ledgerDisplay.amountText}
          </span>
          <span class="text-[11px]" aria-hidden="true">
            ⓘ
          </span>
        </button>
        <button
          id="ledger-reset"
          type="button"
          disabled={ledgerResetting}
          aria-label="캐시 손익 초기화"
          title="캐시 손익 초기화"
          onClick={onLedgerReset}
          class="grid size-[22px] cursor-pointer place-items-center rounded-[5px] border-0 bg-transparent p-0 text-[15px] leading-none text-ui-muted hover:bg-ui-content/10 hover:text-ui-content focus-visible:outline-2 focus-visible:outline-ui-accent disabled:cursor-wait disabled:opacity-70"
        >
          ×
        </button>
        <div
          id="ledger-popover"
          role="tooltip"
          class="pointer-events-none invisible absolute bottom-[calc(100%+11px)] left-[-2px] z-20 w-[190px] translate-y-1 rounded-lg border border-ui-on-popover/20 bg-ui-popover px-3 py-[11px] text-ui-on-popover opacity-0 shadow-xl transition duration-150 group-focus-within:pointer-events-auto group-focus-within:visible group-focus-within:translate-y-0 group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:visible group-hover:translate-y-0 group-hover:opacity-100"
        >
          <div class="flex flex-col gap-1.5">
            <div class="flex justify-between gap-3 text-[11px] tabular-nums">
              <span>읽기</span>
              <span id="ledger-read-detail">{ledgerReadText}</span>
            </div>
            <div class="flex justify-between gap-3 text-[11px] tabular-nums">
              <span>쓰기</span>
              <span id="ledger-write-detail">{ledgerWriteText}</span>
            </div>
            <div class="flex justify-between gap-3 border-t border-ui-on-popover/25 pt-1 text-[11px] tabular-nums">
              <span>캐시 손익</span>
              <span
                id="ledger-amount"
                class={ledgerResetFailed ? 'text-ui-loss' : LEDGER_TONE_CLASSES[ledgerDisplay.tone]}
              >
                {ledgerResetFailed ? '초기화 실패' : ledgerDisplay.amountText}
              </span>
            </div>
          </div>
        </div>
      </div>
      <button
        id="close"
        type="button"
        onClick={onClose}
        class="min-w-[58px] cursor-pointer rounded-[9px] border border-ui-content/70 bg-ui-contrast px-3.5 py-2 text-xs font-semibold text-ui-background hover:bg-ui-contrast-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-accent"
      >
        닫기
      </button>
    </footer>
  );
}
