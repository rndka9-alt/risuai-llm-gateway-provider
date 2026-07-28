import { isSensitivePropertyName, maskSensitiveValue } from '../../sensitive-values';

// 커스텀 extra body처럼 사용자가 임의 필드를 실을 수 있는 JSON에서 속성명 기준으로
// 민감값을 마스킹한다. JSON.parse 산출물만 받으므로 순환 참조는 없다.
export function maskSensitiveDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskSensitiveDeep);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([name, propertyValue]) => [
        name,
        isSensitivePropertyName(name) && typeof propertyValue === 'string'
          ? maskSensitiveValue(propertyValue)
          : maskSensitiveDeep(propertyValue),
      ]),
    );
  }
  return value;
}
