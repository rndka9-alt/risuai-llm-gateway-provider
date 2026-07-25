import { isRecord } from './is-record';

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

export function serializeObject(value: object): string {
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

export function safelyFormatErrorDetail(value: unknown): string {
  try {
    return formatErrorDetail(value);
  } catch (error) {
    const reason =
      error instanceof Error && error.message !== '' ? error.message : '알 수 없는 변환 오류';
    return `[오류 정보를 표시할 수 없어요: ${reason}]`;
  }
}
