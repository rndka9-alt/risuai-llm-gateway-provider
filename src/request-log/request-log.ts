import type { LlmFinishReason, LlmUsage } from 'llm-io';
import type { BridgeWireObserver } from '../bridge-fetch';
import { maskHeaderValues } from './internal/mask-header-values';
import { redactRequestBody } from './internal/redact-request-body';
import { redactResponseBody } from './internal/redact-response-body';
import { publishRequestLog, pushRequestLogEntry } from './store';
import type { RequestLogEntry, RequestLogOutcome } from './types';

export interface RequestLogRecorder {
  wireObserver: BridgeWireObserver;
  recordFailure(content: string): void;
  recordSuccess(details: { finishReason?: LlmFinishReason; usage?: LlmUsage }): void;
}

interface BeginRequestLogInput {
  model: string;
  streamingMode: string;
}

let nextRequestLogEntryId = 1;

// 로그는 부가 기능이다 — 기록 실패가 채팅 요청을 방해하지 않도록 경로별로 격리한다.
function safelyRecord(record: () => void): void {
  try {
    record();
  } catch (error) {
    console.error('[llm-gateway-provider] request log update failed', error);
  }
}

export function beginRequestLog(input: BeginRequestLogInput): RequestLogRecorder {
  const entry: RequestLogEntry = {
    id: nextRequestLogEntryId,
    model: input.model,
    startedAtIso: new Date().toISOString(),
    streamingMode: input.streamingMode,
  };
  nextRequestLogEntryId += 1;
  const startedAtMs = Date.now();
  safelyRecord(() => pushRequestLogEntry(entry));

  const finalize = (outcome: RequestLogOutcome) => {
    safelyRecord(() => {
      entry.durationMs = Date.now() - startedAtMs;
      entry.outcome = outcome;
      publishRequestLog();
    });
  };

  return {
    wireObserver: {
      onRequest(request) {
        safelyRecord(() => {
          entry.request = {
            body: redactRequestBody(request.body),
            headers: maskHeaderValues(request.headers),
            method: request.method,
            url: request.url,
          };
          publishRequestLog();
        });
      },
      onResponse(response) {
        safelyRecord(() => {
          entry.response = {
            body: redactResponseBody(response.bodyText),
            headers: maskHeaderValues(response.headers),
            status: response.status,
          };
          publishRequestLog();
        });
      },
    },
    recordFailure(content) {
      finalize({ kind: 'failure', content });
    },
    recordSuccess(details) {
      finalize({ kind: 'success', ...details });
    },
  };
}
