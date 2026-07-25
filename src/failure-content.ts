import { LlmHttpError, LlmInBandError, type LlmUsage } from 'llm-io';
import { BridgeFetchError } from './bridge-fetch';

const CONTINUED_FAILURE_GUIDANCE =
  '같은 문제가 계속되면 아래 오류 정보를 플러그인 개발자에게 알려 주세요.';
const CONTINUED_FAILURE_WITHOUT_DETAILS_GUIDANCE =
  '같은 문제가 계속되면 플러그인 개발자에게 알려 주세요.';
const REDACTED_VALUE = '[가려진 값]';
const CIRCULAR_REFERENCE = '[순환 참조]';
const MAX_CAUSE_DEPTH = 3;

const SENSITIVE_PROPERTY_NAMES = new Set([
  'accesstoken',
  'apikey',
  'authorization',
  'bearertoken',
  'clientsecret',
  'cookie',
  'idtoken',
  'password',
  'proxyauthorization',
  'refreshtoken',
  'secret',
  'setcookie',
  'token',
  'xapikey',
]);

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

function isSensitivePropertyName(name: string): boolean {
  return SENSITIVE_PROPERTY_NAMES.has(name.toLowerCase().replaceAll('-', '').replaceAll('_', ''));
}

function toSerializableError(error: Error): Record<string, unknown> {
  const serialized: Record<string, unknown> = {
    name: error.name,
    message: error.message,
  };
  if (error.cause !== undefined) serialized.cause = error.cause;
  for (const [name, value] of Object.entries(error)) {
    if (name !== 'name' && name !== 'message' && name !== 'cause' && name !== 'stack') {
      serialized[name] = value;
    }
  }
  return serialized;
}

function serializeObject(value: object): string {
  const seen = new WeakSet<object>();
  try {
    const serialized = JSON.stringify(
      value,
      (name: string, current: unknown): unknown => {
        if (isSensitivePropertyName(name)) return REDACTED_VALUE;
        if (typeof current === 'bigint') return current.toString();
        if (typeof current !== 'object' || current === null) return current;
        if (seen.has(current)) return CIRCULAR_REFERENCE;
        seen.add(current);
        return current instanceof Error ? toSerializableError(current) : current;
      },
      2,
    );
    return serialized ?? '[객체를 JSON으로 표현할 수 없어요]';
  } catch (error) {
    const reason =
      error instanceof Error && error.message !== '' ? error.message : '알 수 없는 직렬화 오류';
    return `[오류 정보를 JSON으로 표시할 수 없어요: ${reason}]`;
  }
}

function formatErrorLike(
  name: string,
  message: string,
  cause: unknown,
  identity: object,
  causeDepth: number,
  ancestors: Set<object>,
): string {
  if (ancestors.has(identity)) return CIRCULAR_REFERENCE;

  const normalizedName = name === '' ? 'Error' : name;
  const summary = message === '' ? normalizedName : `${normalizedName}: ${message}`;
  if (cause === undefined) return summary;
  if (causeDepth >= MAX_CAUSE_DEPTH) return `${summary}\n원인: [추가 원인은 생략했어요]`;

  ancestors.add(identity);
  const formattedCause = formatErrorDetail(cause, causeDepth + 1, ancestors);
  ancestors.delete(identity);
  if (formattedCause === '' || formattedCause === summary) return summary;
  return `${summary}\n원인: ${formattedCause.replaceAll('\n', '\n  ')}`;
}

function isErrorLikeRecord(value: unknown): value is Record<string, unknown> & {
  name: string;
  message: string;
} {
  return isRecord(value) && typeof value.name === 'string' && typeof value.message === 'string';
}

function formatErrorDetail(value: unknown, causeDepth = 0, ancestors = new Set<object>()): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) {
    return formatErrorLike(value.name, value.message, value.cause, value, causeDepth, ancestors);
  }
  if (isErrorLikeRecord(value)) {
    return formatErrorLike(value.name, value.message, value.cause, value, causeDepth, ancestors);
  }
  if (typeof value === 'object' && value !== null) return serializeObject(value);
  return String(value);
}

function safelyFormatErrorDetail(value: unknown): string {
  try {
    return formatErrorDetail(value);
  } catch (error) {
    const reason =
      error instanceof Error && error.message !== '' ? error.message : '알 수 없는 변환 오류';
    return `[오류 정보를 표시할 수 없어요: ${reason}]`;
  }
}

function withFailureDetails(summary: string, detail: string, status?: number): string {
  const hasDetails = detail !== '' || status !== undefined;
  const guidance = hasDetails
    ? CONTINUED_FAILURE_GUIDANCE
    : CONTINUED_FAILURE_WITHOUT_DETAILS_GUIDANCE;
  if (!hasDetails) return `${summary}\n${guidance}`;

  const detailsTitle =
    status === undefined ? '자세한 오류 정보' : `자세한 오류 정보 (오류 코드 ${status})`;
  return detail === ''
    ? `${summary}\n${guidance}\n\n${detailsTitle}`
    : `${summary}\n${guidance}\n\n${detailsTitle}\n${detail}`;
}

export interface EmptyStreamDiagnostics {
  finishReason: string | undefined;
  reasoningDeltaCount: number;
  streamEventCount: number;
  usage: LlmUsage | undefined;
}

/** 내용 없이 끝난 스트림을 무음 성공 대신 원인별 실패 안내로 바꿉니다. */
export function toEmptyStreamFailureContent(diagnostics: EmptyStreamDiagnostics): string {
  const detail = serializeObject(diagnostics);

  // reasoning 델타를 노출하지 않는 모델은 usage의 reasoning 토큰으로만 소진이 드러난다
  // (실측: SSE 24건 중 4건이 reasoning 토큰이 있는데 델타 미노출).
  const reasoningTokens = diagnostics.usage?.reasoningTokens;
  const consumedReasoning =
    diagnostics.reasoningDeltaCount > 0 || (reasoningTokens !== undefined && reasoningTokens > 0);
  if (diagnostics.finishReason === 'length' && consumedReasoning) {
    return withFailureDetails(
      '모델이 내부 추론(reasoning)에 출력 한도를 모두 사용해서 본문 없이 끝났어요.\n' +
        'RisuAI의 응답 최대 토큰을 늘리거나, 플러그인 설정에서 reasoning 수준을 낮춰 보세요.',
      detail,
    );
  }
  // 스트리밍 off 전환 유도는 우회이자 진단이다 — 같은 본문이라도 generate() 경로는
  // JSON 파싱을 타서 구체적인 오류가 그대로 드러난다.
  const RETRY_GUIDANCE =
    '일시적인 문제일 수 있으니 다시 시도해 보시고, 반복되면 플러그인 설정에서 ' +
    "스트리밍 모드를 '사용 안 함'으로 바꿔 다시 시도해 보세요. 더 자세한 오류가 보일 수 있어요.";
  if (diagnostics.streamEventCount === 0) {
    // streamEventCount는 wire 청크가 아니라 정규화 이벤트 수라, 내용 없는 필러 청크만
    // 받은 경우도 0이 된다 — 세부 구분은 진단 JSON이 담당한다.
    return withFailureDetails(`LLM Gateway에서 빈 응답을 받았어요.\n${RETRY_GUIDANCE}`, detail);
  }
  return withFailureDetails(
    `LLM Gateway 응답이 내용 없이 끝났어요.\n${RETRY_GUIDANCE}`,
    detail,
  );
}

/** 사용자에게 오류 종류를 구분해 알리되 Gateway·브릿지 원문은 그대로 보존합니다. */
export function toFailureContent(error: unknown): string {
  if (error instanceof LlmHttpError) {
    if (error.status === 400 && isGatewayZodErrorBody(error.body)) {
      return withFailureDetails(
        'LLM Gateway가 요청 내용에 문제가 있다고 응답했어요.',
        error.body,
        error.status,
      );
    }
    return withFailureDetails('LLM Gateway가 요청을 처리하지 못했어요.', error.body, error.status);
  }
  if (error instanceof LlmInBandError) {
    // HTTP 200 뒤에 숨은 게이트웨이 오류라 상태 코드가 없다 — 원문 payload로만 안내한다.
    return withFailureDetails(
      'LLM Gateway가 응답 도중 오류를 반환했어요.',
      safelyFormatErrorDetail(error.error),
    );
  }
  if (error instanceof BridgeFetchError) {
    return withFailureDetails(
      'RisuAI에서 LLM Gateway 요청을 처리하는 중 문제가 발생했어요.',
      safelyFormatErrorDetail(error.detail),
    );
  }
  return withFailureDetails(
    '플러그인에서 LLM Gateway 요청을 처리하는 중 문제가 발생했어요.',
    safelyFormatErrorDetail(error),
  );
}
