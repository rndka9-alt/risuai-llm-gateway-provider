import { LlmHttpError, LlmInBandError } from 'llm-io';
import { describe, expect, it } from 'vitest';
import { BridgeFetchError } from '../bridge-fetch';
import { USER_ERROR_CODES, type UserErrorCode } from '../error-codes';
import {
  toEmptyStreamFailureContent,
  toFailureContent,
  toMissingApiKeyFailureContent,
} from '../failure-content';

describe('toFailureContent', () => {
  it('Gateway Zod 400을 요청 내용 문제로 안내하고 body 원문을 보존한다', () => {
    const body = `{
  "success": false,
  "error": {"issues":[{"path":["model"],"message":"Required"}],"name":"ZodError"}
}`;

    expect(toFailureContent(new LlmHttpError(400, body))).toBe(
      'LLM Gateway가 요청 내용에 문제가 있다고 응답했어요.\n' +
        '같은 문제가 계속되면 아래 오류 정보를 플러그인 개발자에게 알려 주세요.\n\n' +
        `자세한 오류 정보 (LGP:ERR:201, 오류 코드 400)\n${body}`,
    );
  });

  it('그 외 실제 HTTP 400은 Gateway 처리 실패로 안내하고 body 원문을 보존한다', () => {
    const body = '{"error":{"message":"unsupported model","code":"bad_request"}}';

    expect(toFailureContent(new LlmHttpError(400, body))).toBe(
      'LLM Gateway가 요청을 처리하지 못했어요.\n' +
        '같은 문제가 계속되면 아래 오류 정보를 플러그인 개발자에게 알려 주세요.\n\n' +
        `자세한 오류 정보 (LGP:ERR:202, 오류 코드 400)\n${body}`,
    );
  });

  it('400이 아닌 HTTP 오류도 body 원문을 보존한다', () => {
    const body = '<html>upstream unavailable</html>';

    expect(toFailureContent(new LlmHttpError(503, body))).toBe(
      'LLM Gateway가 요청을 처리하지 못했어요.\n' +
        '같은 문제가 계속되면 아래 오류 정보를 플러그인 개발자에게 알려 주세요.\n\n' +
        `자세한 오류 정보 (LGP:ERR:202, 오류 코드 503)\n${body}`,
    );
  });

  it('reasoning 델타 없이 usage로만 드러난 토큰 소진도 reasoning 안내로 분류한다', () => {
    const diagnostics = {
      finishReason: 'length',
      reasoningDeltaCount: 0,
      streamEventCount: 3,
      usage: { reasoningTokens: 512 },
    };

    expect(toEmptyStreamFailureContent(diagnostics)).toBe(
      '모델이 내부 추론(reasoning)에 출력 한도를 모두 사용해서 본문 없이 끝났어요.\n' +
        'RisuAI의 응답 최대 토큰을 늘리거나, 플러그인 설정에서 reasoning 수준을 낮춰 보세요.\n' +
        '같은 문제가 계속되면 아래 오류 정보를 플러그인 개발자에게 알려 주세요.\n\n' +
        `자세한 오류 정보 (LGP:ERR:302)\n${JSON.stringify(diagnostics, null, 2)}`,
    );
  });

  it('이벤트가 없는 빈 스트림은 전송 재진단 안내와 진단 정보를 보존한다', () => {
    const diagnostics = {
      finishReason: undefined,
      reasoningDeltaCount: 0,
      streamEventCount: 0,
      usage: undefined,
    };

    expect(toEmptyStreamFailureContent(diagnostics)).toBe(
      'LLM Gateway에서 빈 응답을 받았어요.\n' +
        '일시적인 문제일 수 있으니 다시 시도해 보시고, 반복되면 플러그인 설정에서 ' +
        "스트리밍 모드를 '사용 안 함'으로 바꿔 다시 시도해 보세요. 더 자세한 오류가 보일 수 있어요.\n" +
        '같은 문제가 계속되면 아래 오류 정보를 플러그인 개발자에게 알려 주세요.\n\n' +
        `자세한 오류 정보 (LGP:ERR:303)\n${JSON.stringify(diagnostics, null, 2)}`,
    );
  });

  it('이벤트는 있지만 본문이 없는 스트림은 내용 없는 완료로 안내한다', () => {
    const diagnostics = {
      finishReason: 'stop',
      reasoningDeltaCount: 0,
      streamEventCount: 2,
      usage: undefined,
    };

    expect(toEmptyStreamFailureContent(diagnostics)).toBe(
      'LLM Gateway 응답이 내용 없이 끝났어요.\n' +
        '일시적인 문제일 수 있으니 다시 시도해 보시고, 반복되면 플러그인 설정에서 ' +
        "스트리밍 모드를 '사용 안 함'으로 바꿔 다시 시도해 보세요. 더 자세한 오류가 보일 수 있어요.\n" +
        '같은 문제가 계속되면 아래 오류 정보를 플러그인 개발자에게 알려 주세요.\n\n' +
        `자세한 오류 정보 (LGP:ERR:304)\n${JSON.stringify(diagnostics, null, 2)}`,
    );
  });

  it('in-band 오류를 게이트웨이 응답 오류로 안내하고 payload 원문을 보존한다', () => {
    const payload = {
      message: "Invalid schema for response_format 'x'",
      type: 'invalid_request_error',
      code: 'invalid_json_schema',
    };

    expect(
      toFailureContent(
        new LlmInBandError(payload, 'OpenAI chat completions stream returned an error'),
      ),
    ).toBe(
      'LLM Gateway가 응답 도중 오류를 반환했어요.\n' +
        '같은 문제가 계속되면 아래 오류 정보를 플러그인 개발자에게 알려 주세요.\n\n' +
        `자세한 오류 정보 (LGP:ERR:301)\n${JSON.stringify(payload, null, 2)}`,
    );
  });

  it('문자열 payload의 in-band 오류도 원문 그대로 보존한다', () => {
    expect(toFailureContent(new LlmInBandError('rate limited', 'context'))).toBe(
      'LLM Gateway가 응답 도중 오류를 반환했어요.\n' +
        '같은 문제가 계속되면 아래 오류 정보를 플러그인 개발자에게 알려 주세요.\n\n' +
        '자세한 오류 정보 (LGP:ERR:301)\nrate limited',
    );
  });

  it('브릿지 실패를 HTTP 응답과 구분하고 원본 오류 문자열을 보존한다', () => {
    const detail = 'TypeError: Load failed';

    expect(toFailureContent(new BridgeFetchError(detail))).toBe(
      'RisuAI에서 LLM Gateway 요청을 처리하는 중 문제가 발생했어요.\n' +
        '같은 문제가 계속되면 아래 오류 정보를 플러그인 개발자에게 알려 주세요.\n\n' +
        `자세한 오류 정보 (LGP:ERR:101)\n${detail}`,
    );
  });

  it('일반 Error의 cause chain을 상세 정보에 남긴다', () => {
    const error = new Error('응답을 해석하지 못했어요.', {
      cause: new TypeError('Unexpected token'),
    });

    expect(toFailureContent(error)).toBe(
      '플러그인에서 LLM Gateway 요청을 처리하는 중 문제가 발생했어요.\n' +
        '같은 문제가 계속되면 아래 오류 정보를 플러그인 개발자에게 알려 주세요.\n\n' +
        '자세한 오류 정보 (LGP:ERR:002)\n' +
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

  it('API 키 미설정 안내의 기존 해결 방법과 오류 코드를 함께 반환한다', () => {
    expect(toMissingApiKeyFailureContent()).toBe(
      'LLM Gateway API 키가 설정되어 있지 않아요. (LGP:ERR:001)\n' +
        '플러그인 설정에서 API 키를 입력해 주세요.',
    );
  });

  it('레지스트리의 모든 오류 코드를 각 사용자 실패 분기에 정확히 한 번 표시한다', () => {
    expect(USER_ERROR_CODES).toEqual({
      missingApiKey: 'LGP:ERR:001',
      unexpectedPluginFailure: 'LGP:ERR:002',
      bridgeTransportFailure: 'LGP:ERR:101',
      gatewayRequestValidationFailure: 'LGP:ERR:201',
      gatewayHttpFailure: 'LGP:ERR:202',
      gatewayInBandFailure: 'LGP:ERR:301',
      emptyStreamReasoningLimit: 'LGP:ERR:302',
      emptyStreamWithoutEvents: 'LGP:ERR:303',
      emptyStreamWithoutText: 'LGP:ERR:304',
    });

    const contentsByCode = {
      [USER_ERROR_CODES.missingApiKey]: toMissingApiKeyFailureContent(),
      [USER_ERROR_CODES.unexpectedPluginFailure]: toFailureContent(new Error('unexpected')),
      [USER_ERROR_CODES.bridgeTransportFailure]: toFailureContent(
        new BridgeFetchError('bridge failed'),
      ),
      [USER_ERROR_CODES.gatewayRequestValidationFailure]: toFailureContent(
        new LlmHttpError(400, '{"error":{"name":"ZodError"}}'),
      ),
      [USER_ERROR_CODES.gatewayHttpFailure]: toFailureContent(new LlmHttpError(503, 'unavailable')),
      [USER_ERROR_CODES.gatewayInBandFailure]: toFailureContent(
        new LlmInBandError('in-band failed', 'context'),
      ),
      [USER_ERROR_CODES.emptyStreamReasoningLimit]: toEmptyStreamFailureContent({
        finishReason: 'length',
        reasoningDeltaCount: 1,
        streamEventCount: 1,
        usage: undefined,
      }),
      [USER_ERROR_CODES.emptyStreamWithoutEvents]: toEmptyStreamFailureContent({
        finishReason: undefined,
        reasoningDeltaCount: 0,
        streamEventCount: 0,
        usage: undefined,
      }),
      [USER_ERROR_CODES.emptyStreamWithoutText]: toEmptyStreamFailureContent({
        finishReason: 'stop',
        reasoningDeltaCount: 0,
        streamEventCount: 1,
        usage: undefined,
      }),
    } satisfies Record<UserErrorCode, string>;

    expect(Object.keys(contentsByCode)).toEqual(Object.values(USER_ERROR_CODES));
    for (const [errorCode, content] of Object.entries(contentsByCode)) {
      expect(content.match(/LGP:ERR:\d{3}/g)).toEqual([errorCode]);
    }
  });
});
