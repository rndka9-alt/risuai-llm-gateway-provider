// 민감값 판별·마스킹의 단일 출처 — failure-content의 완전 마스킹('[가려진 값]')과
// 요청 로그의 프리픽스 보존 마스킹이 같은 속성명 목록을 공유한다.
export const SENSITIVE_PROPERTY_NAMES = new Set([
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

export function isSensitivePropertyName(name: string): boolean {
  return SENSITIVE_PROPERTY_NAMES.has(name.toLowerCase().replaceAll('-', '').replaceAll('_', ''));
}

// 어떤 키가 실렸는지 식별은 가능하되 값 복원은 불가능하도록 앞 4자만 남긴다.
export function maskSensitiveValue(value: string): string {
  const BEARER_PREFIX = 'Bearer ';
  if (value.startsWith(BEARER_PREFIX)) {
    return `${BEARER_PREFIX}${maskSensitiveValue(value.slice(BEARER_PREFIX.length))}`;
  }
  return value.length >= 8 ? `${value.slice(0, 4)}***` : '***';
}
