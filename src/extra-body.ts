import type { OpenAIChatCompletionsExtraBody } from 'llm-io';

// 설정 편집기(RequestBodyField)로 작성한 커스텀 요청 body를 요청 직전에 적용하는 계약:
// 겹치는 필드는 커스텀이 덮어쓰고(deep merge), invalid JSON이면 그 요청에서는 통째로 무시한다.

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 커스텀 body(raw JSON 텍스트)를 파싱한다. 빈 초안·invalid JSON·object가 아닌 값은
 *  전부 "이번 요청에서는 적용 안 함"(undefined)으로 취급한다 — 설정 편집기의 안내와 동일한 계약 */
export function parseCustomExtraBody(rawJson: string): Record<string, unknown> | undefined {
  if (rawJson.trim() === '') return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch (error) {
    console.warn(
      '[llm-gateway-provider] 커스텀 요청 body JSON이 유효하지 않아 이번 요청에서는 무시합니다',
      error,
    );
    return undefined;
  }

  if (!isPlainObject(parsed)) {
    console.warn(
      '[llm-gateway-provider] 커스텀 요청 body는 JSON object여야 합니다. 이번 요청에서는 무시합니다',
    );
    return undefined;
  }
  return parsed;
}

/** deep merge — 양쪽 다 plain object인 키만 재귀하고,
 *  그 외(배열·원시·타입 불일치)는 custom이 통째로 덮어쓴다 */
export function mergeExtraBody(
  base: Record<string, unknown>,
  custom: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base };
  for (const [key, customValue] of Object.entries(custom)) {
    const baseValue = merged[key];
    merged[key] =
      isPlainObject(baseValue) && isPlainObject(customValue)
        ? mergeExtraBody(baseValue, customValue)
        : customValue;
  }
  return merged;
}

/** 플러그인이 조립한 extraBody 위에 커스텀 body를 deep merge한 결과를 돌려준다.
 *  커스텀이 없거나 invalid면 원본을 그대로 반환한다 */
export function applyCustomExtraBody(
  baseExtraBody: OpenAIChatCompletionsExtraBody,
  rawCustomJson: string,
): OpenAIChatCompletionsExtraBody {
  const customBody = parseCustomExtraBody(rawCustomJson);
  if (customBody === undefined) return baseExtraBody;

  // llm-io의 닫힌 인터페이스와 느슨한 Record 사이는 직렬화 왕복으로 잇는다 —
  // 어차피 wire에서 JSON이 될 값이라 의미 손실이 없다 (타입 단언 회피)
  const base: Record<string, unknown> = JSON.parse(JSON.stringify(baseExtraBody));
  const merged: OpenAIChatCompletionsExtraBody = JSON.parse(
    JSON.stringify(mergeExtraBody(base, customBody)),
  );
  return merged;
}
