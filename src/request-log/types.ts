import type { LlmFinishReason, LlmUsage } from 'llm-io';

// wire에 실제로 실린 요청/응답에서 채팅 내용만 걷어낸 스냅샷. 문자열 필드는
// 기록 시점에 마스킹·자리표시자 처리가 끝난 표시용 값이다.
export interface RequestLogWireRequest {
  body: string;
  headers: Record<string, string>;
  method: string;
  url: string;
}

export interface RequestLogWireResponse {
  body: string;
  headers: Record<string, string>;
  status: number;
}

export type RequestLogOutcome =
  | { kind: 'success'; finishReason?: LlmFinishReason; usage?: LlmUsage }
  | { kind: 'failure'; content: string };

export interface RequestLogEntry {
  id: number;
  model: string;
  startedAtIso: string;
  streamingMode: string;
  durationMs?: number;
  request?: RequestLogWireRequest;
  response?: RequestLogWireResponse;
  outcome?: RequestLogOutcome;
}
