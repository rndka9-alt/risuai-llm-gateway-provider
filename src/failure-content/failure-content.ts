import { LlmHttpError, LlmInBandError } from 'llm-io';
import { BridgeFetchError } from '../bridge-fetch';
import { USER_ERROR_CODES } from './error-codes';
import { safelyFormatErrorDetail } from './internal/error-detail';
import { withFailureDetails } from './internal/failure-details';
import { isRecord } from './internal/is-record';

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

export function toMissingApiKeyFailureContent(): string {
  return (
    `LLM Gateway API 키가 설정되어 있지 않아요. (${USER_ERROR_CODES.missingApiKey})\n` +
    '플러그인 설정에서 API 키를 입력해 주세요.'
  );
}

// 에러 클래스 없이 호출 지점 지식으로 분류한다 — prepare의 storage 격리 블록만 이
// 실패를 만들 수 있다 (prepare-prompt-cache-request.ts). 요청 전송 전이라 과금이 없다.
export function toCacheStorageFailureContent(error: unknown): string {
  return withFailureDetails(
    '플러그인 저장소에서 프롬프트 캐시 키와 상태를 읽거나 쓰지 못했어요.\n' +
      '이번 요청은 전송되지 않았어요.',
    safelyFormatErrorDetail(error),
    USER_ERROR_CODES.cacheStorageFailure,
  );
}

/** 사용자에게 오류 종류를 구분해 알리되 Gateway·브릿지 원문은 그대로 보존합니다. */
export function toFailureContent(error: unknown): string {
  if (error instanceof LlmHttpError) {
    if (error.status === 400 && isGatewayZodErrorBody(error.body)) {
      return withFailureDetails(
        'LLM Gateway가 요청 내용에 문제가 있다고 응답했어요.',
        error.body,
        USER_ERROR_CODES.gatewayRequestValidationFailure,
        error.status,
      );
    }
    return withFailureDetails(
      'LLM Gateway가 요청을 처리하지 못했어요.',
      error.body,
      USER_ERROR_CODES.gatewayHttpFailure,
      error.status,
    );
  }
  if (error instanceof LlmInBandError) {
    // HTTP 200 뒤에 숨은 게이트웨이 오류라 상태 코드가 없다 — 원문 payload로만 안내한다.
    return withFailureDetails(
      'LLM Gateway가 응답 도중 오류를 반환했어요.',
      safelyFormatErrorDetail(error.error),
      USER_ERROR_CODES.gatewayInBandFailure,
    );
  }
  if (error instanceof BridgeFetchError) {
    return withFailureDetails(
      'RisuAI에서 LLM Gateway 요청을 처리하는 중 문제가 발생했어요.',
      safelyFormatErrorDetail(error.detail),
      USER_ERROR_CODES.bridgeTransportFailure,
    );
  }
  return withFailureDetails(
    '플러그인에서 LLM Gateway 요청을 처리하는 중 문제가 발생했어요.',
    safelyFormatErrorDetail(error),
    USER_ERROR_CODES.unexpectedPluginFailure,
  );
}
