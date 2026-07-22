import { LlmHttpError } from 'llm-io';
import { BridgeFetchError } from './bridge-fetch';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isGatewayZodErrorBody(body: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return false;
  }
  if (!isRecord(parsed) || !isRecord(parsed.error)) return false;
  return parsed.error.name === 'ZodError';
}

function appendRawBody(title: string, body: string): string {
  return body === '' ? title : `${title}\n${body}`;
}

/** 사용자에게 오류 종류를 구분해 알리되 Gateway·브릿지 원문은 그대로 보존합니다. */
export function toFailureContent(error: unknown): string {
  if (error instanceof LlmHttpError) {
    if (error.status === 400 && isGatewayZodErrorBody(error.body)) {
      return appendRawBody('LLM Gateway 요청 형식 오류 (HTTP 400)', error.body);
    }
    if (error.status === 400) {
      return appendRawBody('LLM Gateway가 요청을 거절했어요 (HTTP 400)', error.body);
    }
    return appendRawBody(`LLM Gateway 요청 실패 (HTTP ${error.status})`, error.body);
  }
  if (error instanceof BridgeFetchError) {
    return appendRawBody(
      'RisuAI 네트워크/브리지 오류 (Gateway HTTP 상태 확인 불가)',
      error.message,
    );
  }
  if (error instanceof Error) {
    return `LLM Gateway 요청 실패: ${error.message}`;
  }
  return `LLM Gateway 요청 실패: ${String(error)}`;
}
