import type { RequestLogEntry } from './types';

export const MAX_REQUEST_LOG_ENTRIES = 5;

type RequestLogListener = () => void;

// 영속화하지 않는 휘발성 링 버퍼 — 새로고침에 사라지는 것을 수용하는 대신
// 저장소 계약·마이그레이션·비원자 갱신 문제를 통째로 회피한다. 최신이 앞이다.
const requestLogEntries: RequestLogEntry[] = [];
const requestLogListeners = new Set<RequestLogListener>();
let requestLogSnapshot: readonly RequestLogEntry[] = [];

export function getRequestLogSnapshot(): readonly RequestLogEntry[] {
  return requestLogSnapshot;
}

export function subscribeRequestLog(listener: RequestLogListener): () => void {
  requestLogListeners.add(listener);
  return () => requestLogListeners.delete(listener);
}

// 항목 객체는 recorder가 제자리 갱신하므로, 배열 identity만 새로 발행해
// 구독자(설정 UI state)가 리렌더를 판별하게 한다.
export function publishRequestLog(): void {
  requestLogSnapshot = [...requestLogEntries];
  for (const listener of requestLogListeners) listener();
}

export function pushRequestLogEntry(entry: RequestLogEntry): void {
  requestLogEntries.unshift(entry);
  while (requestLogEntries.length > MAX_REQUEST_LOG_ENTRIES) {
    requestLogEntries.pop();
  }
  publishRequestLog();
}
