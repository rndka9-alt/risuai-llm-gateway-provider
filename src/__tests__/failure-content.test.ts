import { LlmHttpError } from 'llm-io';
import { describe, expect, it } from 'vitest';
import { BridgeFetchError } from '../bridge-fetch';
import { toFailureContent } from '../failure-content';

describe('toFailureContent', () => {
  it('Gateway Zod 400을 요청 내용 문제로 안내하고 body 원문을 보존한다', () => {
    const body = `{
  "success": false,
  "error": {"issues":[{"path":["model"],"message":"Required"}],"name":"ZodError"}
}`;

    expect(toFailureContent(new LlmHttpError(400, body))).toBe(
      'LLM Gateway가 요청 내용에 문제가 있다고 응답했어요.\n' +
        '같은 문제가 계속되면 아래 오류 정보를 플러그인 개발자에게 알려 주세요.\n\n' +
        `자세한 오류 정보 (오류 코드 400)\n${body}`,
    );
  });

  it('그 외 실제 HTTP 400은 Gateway 처리 실패로 안내하고 body 원문을 보존한다', () => {
    const body = '{"error":{"message":"unsupported model","code":"bad_request"}}';

    expect(toFailureContent(new LlmHttpError(400, body))).toBe(
      'LLM Gateway가 요청을 처리하지 못했어요.\n' +
        '같은 문제가 계속되면 아래 오류 정보를 플러그인 개발자에게 알려 주세요.\n\n' +
        `자세한 오류 정보 (오류 코드 400)\n${body}`,
    );
  });

  it('400이 아닌 HTTP 오류도 body 원문을 보존한다', () => {
    const body = '<html>upstream unavailable</html>';

    expect(toFailureContent(new LlmHttpError(503, body))).toBe(
      'LLM Gateway가 요청을 처리하지 못했어요.\n' +
        '같은 문제가 계속되면 아래 오류 정보를 플러그인 개발자에게 알려 주세요.\n\n' +
        `자세한 오류 정보 (오류 코드 503)\n${body}`,
    );
  });

  it('브릿지 실패를 HTTP 응답과 구분하고 원본 오류 문자열을 보존한다', () => {
    const detail = 'TypeError: Load failed';

    expect(toFailureContent(new BridgeFetchError(detail))).toBe(
      'RisuAI에서 LLM Gateway 요청을 처리하는 중 문제가 발생했어요.\n' +
        '같은 문제가 계속되면 아래 오류 정보를 플러그인 개발자에게 알려 주세요.\n\n' +
        `자세한 오류 정보\n${detail}`,
    );
  });

  it('일반 Error의 cause chain을 상세 정보에 남긴다', () => {
    const error = new Error('응답을 해석하지 못했어요.', {
      cause: new TypeError('Unexpected token'),
    });

    expect(toFailureContent(error)).toBe(
      '플러그인에서 LLM Gateway 요청을 처리하는 중 문제가 발생했어요.\n' +
        '같은 문제가 계속되면 아래 오류 정보를 플러그인 개발자에게 알려 주세요.\n\n' +
        '자세한 오류 정보\n' +
        'Error: 응답을 해석하지 못했어요.\n' +
        '원인: TypeError: Unexpected token',
    );
  });

  it('plain object 오류는 JSON으로 표시하고 민감한 값과 순환 참조를 가린다', () => {
    const detail: Record<string, unknown> = {
      code: 'ERR_BRIDGE',
      authorization: 'Bearer secret',
      nested: { api_key: 'llmgtwy_secret' },
    };
    detail.self = detail;

    const content = toFailureContent(detail);

    expect(content).toContain('"code": "ERR_BRIDGE"');
    expect(content).toContain('"authorization": "[가려진 값]"');
    expect(content).toContain('"api_key": "[가려진 값]"');
    expect(content).toContain('"self": "[순환 참조]"');
    expect(content).not.toContain('[object Object]');
    expect(content).not.toContain('Bearer secret');
    expect(content).not.toContain('llmgtwy_secret');
  });

  it('다른 realm에서 온 Error 형태의 객체도 이름·메시지·cause를 보존한다', () => {
    const error = {
      name: 'TypeError',
      message: 'Load failed',
      cause: { code: 'ERR_NETWORK' },
    };

    const content = toFailureContent(error);

    expect(content).toContain('TypeError: Load failed');
    expect(content).toContain('원인: {');
    expect(content).toContain('"code": "ERR_NETWORK"');
    expect(content).not.toContain('[object Object]');
  });
});
