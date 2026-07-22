import { LlmHttpError } from 'llm-io';
import { describe, expect, it } from 'vitest';
import { BridgeFetchError } from '../bridge-fetch';
import { toFailureContent } from '../failure-content';

describe('toFailureContent', () => {
  it('Gateway Zod 400을 형식 오류로 표시하고 body 원문을 보존한다', () => {
    const body = `{
  "success": false,
  "error": {"issues":[{"path":["model"],"message":"Required"}],"name":"ZodError"}
}`;

    expect(toFailureContent(new LlmHttpError(400, body))).toBe(
      `LLM Gateway 요청 형식 오류 (HTTP 400)\n${body}`,
    );
  });

  it('그 외 실제 HTTP 400은 거절 응답으로 표시하고 body 원문을 보존한다', () => {
    const body = '{"error":{"message":"unsupported model","code":"bad_request"}}';

    expect(toFailureContent(new LlmHttpError(400, body))).toBe(
      `LLM Gateway가 요청을 거절했어요 (HTTP 400)\n${body}`,
    );
  });

  it('400이 아닌 HTTP 오류도 body 원문을 보존한다', () => {
    const body = '<html>upstream unavailable</html>';

    expect(toFailureContent(new LlmHttpError(503, body))).toBe(
      `LLM Gateway 요청 실패 (HTTP 503)\n${body}`,
    );
  });

  it('브릿지 실패를 HTTP 응답과 구분하고 원본 오류 문자열을 보존한다', () => {
    const detail = 'TypeError: Load failed';

    expect(toFailureContent(new BridgeFetchError(detail))).toBe(
      `RisuAI 네트워크/브리지 오류 (Gateway HTTP 상태 확인 불가)\n${detail}`,
    );
  });
});
