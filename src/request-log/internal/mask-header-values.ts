import { isSensitivePropertyName, maskSensitiveValue } from '../../sensitive-values';

export function maskHeaderValues(
  headers: Record<string, string> | undefined,
): Record<string, string> {
  const masked: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    masked[name] = isSensitivePropertyName(name) ? maskSensitiveValue(value) : value;
  }
  return masked;
}
