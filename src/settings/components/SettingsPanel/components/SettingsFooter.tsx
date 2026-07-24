import { MessageCircleWarning, PiggyBank, Trash2 } from 'lucide-preact';
import { useEffect, useState } from 'preact/hooks';
import { useTopFooterMessage } from '../../../utils/footer-messages';
import {
  getCacheLedgerSnapshot,
  resetCacheLedger,
  subscribeCacheLedger,
  type CacheLedger,
} from '../../../../ledger';
import {
  buildLedgerDisplay,
  formatTokenCount,
  type LedgerDisplay,
} from '../../../utils/ledger-display';
import { useTooltipDisclosure } from '../../../utils/tooltip-disclosure';

const LEDGER_TONE_CLASSES: Record<LedgerDisplay['tone'], string> = {
  gain: 'text-ui-gain',
  loss: 'text-ui-loss',
  neutral: 'text-inherit',
};

function useCacheLedgerSnapshot(): CacheLedger {
  const [snapshot, setSnapshot] = useState<CacheLedger>(getCacheLedgerSnapshot);
  // 요청 완료와 원장 초기화는 컴포넌트 밖에서 일어나므로 ledger store의 publish를
  // 구독해 화면용 snapshot만 갱신한다. 원장의 원천은 외부 store에 유지한다.
  useEffect(() => subscribeCacheLedger(() => setSnapshot(getCacheLedgerSnapshot())), []);
  return snapshot;
}

export function SettingsFooter() {
  const cacheLedger = useCacheLedgerSnapshot();
  const [ledgerResetting, setLedgerResetting] = useState(false);
  const [ledgerResetFailed, setLedgerResetFailed] = useState(false);
  const topMessage = useTopFooterMessage();
  const [dismissedMessageId, setDismissedMessageId] = useState<number | null>(null);

  // 메시지가 해소되면 숨김 선택을 잊어, 같은 메시지가 다시 발행돼도 메시지가 먼저 보인다
  useEffect(() => {
    if (topMessage === null) setDismissedMessageId(null);
  }, [topMessage]);

  // 다른 새 메시지가 오면(id 불일치) 원장을 보던 중이어도 메시지 표시로 돌아간다
  const messageShown = topMessage !== null && topMessage.id !== dismissedMessageId;
  const {
    closeOnEscape,
    closeOnFocusOut,
    expanded: ledgerExpanded,
    rootRef: ledgerRootRef,
    toggleTooltip: toggleLedger,
    triggerRef: ledgerTriggerRef,
  } = useTooltipDisclosure<HTMLDivElement, HTMLButtonElement>();
  const ledgerDisplay = buildLedgerDisplay(cacheLedger);
  const ledgerReadText = formatTokenCount(cacheLedger.readTokens);
  const ledgerWriteText = formatTokenCount(cacheLedger.writeTokens);

  const resetLedger = async (): Promise<void> => {
    setLedgerResetting(true);
    setLedgerResetFailed(false);
    try {
      await resetCacheLedger();
    } catch (error) {
      setLedgerResetFailed(true);
      console.error('[llm-gateway-provider] Failed to reset cache ledger', error);
    } finally {
      setLedgerResetting(false);
    }
  };

  // 메시지 표시(2-1): 원장 100ms 페이드아웃 → 저금통 100ms·문구 150ms 지연 후 페이드인.
  // 원장 복귀(3-1): 저금통 100ms 페이드아웃·메시지 즉시 숨김 → 원장 100ms 지연 후 페이드인.
  const ledgerLayerStateClass = messageShown
    ? 'pointer-events-none opacity-0'
    : topMessage !== null
      ? 'opacity-100 delay-100'
      : 'opacity-100';

  return (
    <footer class="sticky bottom-0 z-10 flex min-h-14 shrink-0 items-center justify-between gap-3 border-t border-ui-frame bg-ui-panel px-4 py-2.5">
      <div class="grid min-w-0 flex-1 items-center">
        <div
          id="ledger-layer"
          ref={ledgerRootRef}
          inert={messageShown}
          class={`group relative col-start-1 row-start-1 flex min-w-0 items-center gap-0.5 transition-opacity duration-100 motion-reduce:transition-none motion-reduce:delay-0 ${ledgerLayerStateClass}`}
          onFocusOut={closeOnFocusOut}
          onKeyDown={closeOnEscape}
        >
          <button
            id="ledger-summary"
            ref={ledgerTriggerRef}
            type="button"
            aria-label="캐시 손익 상세"
            aria-describedby="ledger-popover"
            aria-expanded={ledgerExpanded}
            onClick={toggleLedger}
            class="flex min-w-0 cursor-help items-center gap-1.5 border-0 bg-transparent py-1 pr-0.5 pl-0 text-xs text-ui-muted hover:text-ui-content focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-accent"
          >
            <span
              id="ledger-amount-summary"
              class={`text-sm font-semibold tabular-nums ${LEDGER_TONE_CLASSES[ledgerDisplay.tone]}`}
            >
              {ledgerDisplay.amountText}
            </span>
            <span class="text-xs" aria-hidden="true">
              ⓘ
            </span>
          </button>
          <button
            id="ledger-reset"
            type="button"
            disabled={ledgerResetting}
            aria-label="캐시 손익 초기화"
            title="캐시 손익 초기화"
            onClick={() => void resetLedger()}
            class="grid size-[22px] cursor-pointer place-items-center rounded-[5px] border-0 bg-transparent p-0 text-ui-muted hover:bg-ui-content/10 hover:text-ui-content focus-visible:outline-2 focus-visible:outline-ui-accent disabled:cursor-wait disabled:opacity-70"
          >
            <Trash2 size={14} strokeWidth={1.7} aria-hidden="true" />
          </button>
          <div
            id="ledger-popover"
            role="tooltip"
            class={`absolute bottom-[calc(100%+11px)] left-[-2px] z-20 w-[190px] rounded-lg border border-ui-on-popover/20 bg-ui-popover px-3 py-[11px] text-ui-on-popover shadow-xl transition duration-150 group-focus-within:pointer-events-auto group-focus-within:visible group-focus-within:translate-y-0 group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:visible group-hover:translate-y-0 group-hover:opacity-100 ${ledgerExpanded ? 'pointer-events-auto visible translate-y-0 opacity-100' : 'pointer-events-none invisible translate-y-1 opacity-0'}`}
          >
            <div class="flex flex-col gap-1.5">
              <div class="flex justify-between gap-3 text-xs tabular-nums">
                <span>읽기</span>
                <span id="ledger-read-detail">{ledgerReadText}</span>
              </div>
              <div class="flex justify-between gap-3 text-xs tabular-nums">
                <span>쓰기</span>
                <span id="ledger-write-detail">{ledgerWriteText}</span>
              </div>
              <div class="flex justify-between gap-3 border-t border-ui-on-popover/25 pt-1 text-xs tabular-nums">
                <span>캐시 손익</span>
                <span
                  id="ledger-amount"
                  class={
                    ledgerResetFailed ? 'text-ui-loss' : LEDGER_TONE_CLASSES[ledgerDisplay.tone]
                  }
                >
                  {ledgerResetFailed ? '초기화 실패' : ledgerDisplay.amountText}
                </span>
              </div>
            </div>
          </div>
        </div>
        {topMessage !== null && (
          <div
            class="col-start-1 row-start-1 flex min-w-0 items-center gap-1.5"
            inert={!messageShown}
          >
            <button
              id="ledger-reveal"
              type="button"
              aria-label="캐시 손익 보기"
              onClick={() => setDismissedMessageId(topMessage.id)}
              class={`grid size-[38px] shrink-0 cursor-pointer place-items-center rounded-lg border border-ui-frame bg-ui-control p-0 text-ui-muted transition-opacity duration-100 hover:text-ui-content focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ui-accent motion-reduce:transition-none ${messageShown ? 'animate-[footer-fade-in_100ms_ease-out_100ms_backwards] opacity-100 motion-reduce:animate-none' : 'pointer-events-none opacity-0'}`}
            >
              <PiggyBank size={18} strokeWidth={1.7} aria-hidden="true" />
            </button>
            <p
              id="footer-message"
              aria-live="polite"
              class={`m-0 min-w-0 text-xs leading-[1.45] text-ui-content ${messageShown ? 'animate-[footer-fade-in_100ms_ease-out_150ms_backwards] opacity-100 motion-reduce:animate-none' : 'opacity-0'}`}
            >
              {topMessage.content}
            </p>
          </div>
        )}
      </div>
      <div class="flex items-center self-end">
        {/* 숨김 상태가 38px 자리를 차지해 문구를 밀지 않도록 0fr 기법으로 폭까지 접는다 */}
        {topMessage !== null && (
          <div
            inert={messageShown}
            class={`grid transition-[grid-template-columns,margin] duration-100 motion-reduce:transition-none ${messageShown ? 'mr-0 grid-cols-[0fr]' : 'mr-1.5 grid-cols-[1fr]'}`}
          >
            <div class="min-w-0 overflow-hidden">
              <button
                id="footer-message-reveal"
                type="button"
                aria-label="알림 보기"
                onClick={() => setDismissedMessageId(null)}
                class={`grid size-[38px] cursor-pointer place-items-center rounded-lg border border-ui-frame bg-ui-control p-0 text-ui-muted transition-opacity duration-100 hover:text-ui-content focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ui-accent motion-reduce:transition-none ${messageShown ? 'pointer-events-none opacity-0' : 'opacity-100'}`}
              >
                <MessageCircleWarning size={18} strokeWidth={1.7} aria-hidden="true" />
              </button>
            </div>
          </div>
        )}
        <button
          id="close"
          type="button"
          onClick={() => void risuai.hideContainer()}
          class="min-w-[58px] cursor-pointer rounded-[9px] border border-ui-content/70 bg-ui-contrast px-3.5 py-2 text-sm font-semibold text-ui-background hover:bg-ui-contrast-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-accent"
        >
          닫기
        </button>
      </div>
    </footer>
  );
}
