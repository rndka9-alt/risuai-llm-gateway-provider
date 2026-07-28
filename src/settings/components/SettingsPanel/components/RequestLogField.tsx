import { useEffect, useState } from 'preact/hooks';
import {
  MAX_REQUEST_LOG_ENTRIES,
  formatRequestLogEntry,
  getRequestLogSnapshot,
  subscribeRequestLog,
  type RequestLogEntry,
} from '../../../../request-log';
import { FIELD_CAPTION_CLASS, FIELD_CLASS } from '../../constants';
import { HelpTooltip } from './HelpTooltip';

function useRequestLogEntries(): readonly RequestLogEntry[] {
  const [entries, setEntries] = useState(getRequestLogSnapshot());
  useEffect(() => subscribeRequestLog(() => setEntries(getRequestLogSnapshot())), []);
  return entries;
}

function describeOutcome(entry: RequestLogEntry): { label: string; toneClass: string } {
  if (entry.outcome === undefined) return { label: '진행 중', toneClass: 'text-ui-muted' };
  if (entry.outcome.kind === 'success') return { label: '성공', toneClass: 'text-ui-accent' };
  return { label: '실패', toneClass: 'text-ui-warn' };
}

function formatStartedTime(startedAtIso: string): string {
  const startedAt = new Date(startedAtIso);
  if (Number.isNaN(startedAt.getTime())) return startedAtIso;
  // toLocaleTimeString은 환경에 따라 시(時)를 한 자리로 줄여 행 폭이 들쭉인다 —
  // 항상 두 자리로 패딩해 목록의 세로 정렬을 유지한다.
  const pad = (unit: number) => String(unit).padStart(2, '0');
  return `${pad(startedAt.getHours())}:${pad(startedAt.getMinutes())}:${pad(startedAt.getSeconds())}`;
}

export function RequestLogField() {
  const entries = useRequestLogEntries();
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  async function copyEntry(entry: RequestLogEntry): Promise<void> {
    const text = formatRequestLogEntry(entry);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // 샌드박스 iframe에서 clipboard 권한이 없으면 임시 textarea로 폴백한다.
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
    }
    setCopiedId(entry.id);
    window.setTimeout(() => {
      setCopiedId((currentId) => (currentId === entry.id ? null : currentId));
    }, 1500);
  }

  return (
    <div class={FIELD_CLASS}>
      <span class="flex min-h-4 items-center gap-1">
        <span class={FIELD_CAPTION_CLASS}>요청 로그</span>
        <HelpTooltip id="request-log-tooltip" label="요청 로그 도움말">
          최근 요청 {MAX_REQUEST_LOG_ENTRIES}개의 메타데이터를 보여줘요. 대화 내용은 기록하지 않고,
          새로고침하면 사라져요.
        </HelpTooltip>
      </span>
      {entries.length === 0 ? (
        <span class="text-xs text-ui-muted">아직 기록된 요청이 없어요.</span>
      ) : (
        <ul class="m-0 flex list-none flex-col gap-1 p-0">
          {entries.map((entry) => {
            const outcome = describeOutcome(entry);
            const expanded = expandedId === entry.id;
            return (
              <li key={entry.id} class="rounded-lg border border-ui-frame bg-ui-control">
                <div class="flex items-center gap-2 px-2.5 py-1.5">
                  <button
                    type="button"
                    aria-expanded={expanded}
                    onClick={() => setExpandedId(expanded ? null : entry.id)}
                    class="flex min-w-0 flex-1 cursor-pointer items-center gap-2 border-0 bg-transparent p-0 text-left text-xs text-ui-content"
                  >
                    <span class={`shrink-0 ${outcome.toneClass}`}>{outcome.label}</span>
                    <span class="shrink-0 tabular-nums text-ui-muted">
                      {formatStartedTime(entry.startedAtIso)}
                    </span>
                    {entry.response !== undefined && (
                      <span class="shrink-0 text-ui-muted">HTTP {entry.response.status}</span>
                    )}
                    {entry.durationMs !== undefined && (
                      <span class="shrink-0 text-ui-muted">
                        {(entry.durationMs / 1000).toFixed(1)}s
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => void copyEntry(entry)}
                    class="shrink-0 cursor-pointer rounded border-0 bg-transparent px-1 py-0.5 text-[11px] text-ui-muted hover:text-ui-content"
                  >
                    {copiedId === entry.id ? '복사됨' : '복사'}
                  </button>
                </div>
                {expanded && (
                  <pre class="m-0 max-h-48 overflow-auto border-t border-ui-frame px-2.5 py-2 text-[10px] leading-relaxed break-all whitespace-pre-wrap text-ui-content">
                    {formatRequestLogEntry(entry)}
                  </pre>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
