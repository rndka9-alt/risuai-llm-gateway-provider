import { afterEach, describe, expect, it, vi } from 'vitest';
import { BridgeFetchError, createBridgeFetch } from '../bridge-fetch';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const REQUEST_URL = 'https://api.llmgateway.io/v1/chat/completions';
const REQUEST_BODY = JSON.stringify({ model: 'gpt-5.6', messages: [] });
const REQUEST_HEADERS = { authorization: 'Bearer key', 'content-type': 'application/json' };

// FetchLike 반환 타입은 최소 Response-like라 headers가 없다 — 브릿지 어댑터가
// 실제로 만드는 Response 인스턴스로 좁혀 검사한다.
function asResponse(value: unknown): Response {
  if (!(value instanceof Response)) {
    throw new Error('Response 인스턴스가 아닙니다');
  }
  return value;
}

function createLegacyResult(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    data: new TextEncoder().encode('{"choices":[]}'),
    headers: { 'content-type': 'application/json' },
    status: 200,
    ...overrides,
  };
}

describe('createBridgeFetch', () => {
  describe('risuFetch 브릿지', () => {
    it('nativeFetch가 있어도 server-side 경로를 선택한다', async () => {
      const risuFetch = vi.fn().mockResolvedValue(createLegacyResult());
      const nativeFetch = vi.fn();
      vi.stubGlobal('risuai', { nativeFetch, risuFetch });

      await createBridgeFetch()(REQUEST_URL, {
        body: REQUEST_BODY,
        headers: REQUEST_HEADERS,
        method: 'POST',
      });

      expect(risuFetch).toHaveBeenCalledOnce();
      expect(nativeFetch).not.toHaveBeenCalled();
    });

    it('server-side 경로가 실패해도 nativeFetch로 재시도하지 않는다', async () => {
      const proxyError = new TypeError('proxy unavailable');
      const risuFetch = vi.fn().mockRejectedValue(proxyError);
      const nativeFetch = vi.fn();
      vi.stubGlobal('risuai', { nativeFetch, risuFetch });

      await expect(
        createBridgeFetch()(REQUEST_URL, {
          body: REQUEST_BODY,
          headers: REQUEST_HEADERS,
          method: 'POST',
        }),
      ).rejects.toMatchObject({
        name: BridgeFetchError.name,
        detail: proxyError,
        cause: proxyError,
      });

      expect(risuFetch).toHaveBeenCalledOnce();
      expect(nativeFetch).not.toHaveBeenCalled();
    });

    it('JSON 문자열 body를 파싱해 넘기고 signal을 abortSignal로 변환한다', async () => {
      const risuFetch = vi.fn().mockResolvedValue(createLegacyResult());
      vi.stubGlobal('risuai', { risuFetch });
      const abortController = new AbortController();

      const bridgeFetch = createBridgeFetch();
      await bridgeFetch(REQUEST_URL, {
        body: REQUEST_BODY,
        headers: REQUEST_HEADERS,
        method: 'POST',
        signal: abortController.signal,
      });

      expect(risuFetch).toHaveBeenCalledWith(REQUEST_URL, {
        body: { model: 'gpt-5.6', messages: [] },
        headers: { authorization: 'Bearer key', 'Content-Type': 'application/json' },
        method: 'POST',
        rawResponse: true,
        plainFetchDeforce: true,
        abortSignal: abortController.signal,
      });
    });

    it('소문자 content-type을 Content-Type 하나로 정규화한다', async () => {
      // globalFetch가 'Content-Type' 표기로 기본값을 병합하므로, 소문자 키가 그대로
      // 가면 두 키가 공존해 'application/json, application/json'으로 합쳐진다.
      const risuFetch = vi.fn().mockResolvedValue(createLegacyResult());
      vi.stubGlobal('risuai', { risuFetch });

      const bridgeFetch = createBridgeFetch();
      await bridgeFetch(REQUEST_URL, {
        body: REQUEST_BODY,
        headers: { 'content-type': 'application/json', authorization: 'Bearer key' },
        method: 'POST',
      });

      const passedHeaders = risuFetch.mock.calls[0][1].headers;
      expect(passedHeaders).toEqual({
        'Content-Type': 'application/json',
        authorization: 'Bearer key',
      });
      expect(Object.keys(passedHeaders)).not.toContain('content-type');
    });

    it('이미 abort된 signal이면 risuFetch를 호출하지 않는다', async () => {
      const abortController = new AbortController();
      abortController.abort();
      const risuFetch = vi.fn();
      vi.stubGlobal('risuai', { risuFetch });

      const bridgeFetch = createBridgeFetch();

      await expect(
        bridgeFetch(REQUEST_URL, {
          body: REQUEST_BODY,
          method: 'POST',
          signal: abortController.signal,
        }),
      ).rejects.toThrow(abortController.signal.reason);
      expect(risuFetch).not.toHaveBeenCalled();
    });

    it('204 응답은 body 없이 재구성한다', async () => {
      const risuFetch = vi
        .fn()
        .mockResolvedValue(createLegacyResult({ data: new Uint8Array(0), status: 204 }));
      vi.stubGlobal('risuai', { risuFetch });

      const bridgeFetch = createBridgeFetch();
      const response = asResponse(
        await bridgeFetch(REQUEST_URL, { body: REQUEST_BODY, method: 'POST' }),
      );

      expect(response.status).toBe(204);
      expect(response.body).toBeNull();
    });

    it('Uint8Array data를 status·headers와 함께 Response로 재구성한다', async () => {
      const risuFetch = vi.fn().mockResolvedValue(createLegacyResult());
      vi.stubGlobal('risuai', { risuFetch });

      const bridgeFetch = createBridgeFetch();
      const response = asResponse(
        await bridgeFetch(REQUEST_URL, { body: REQUEST_BODY, method: 'POST' }),
      );

      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('application/json');
      await expect(response.text()).resolves.toBe('{"choices":[]}');
    });

    it('재구성된 Response의 body는 스트림으로도 소비할 수 있다', async () => {
      const risuFetch = vi.fn().mockResolvedValue(createLegacyResult());
      vi.stubGlobal('risuai', { risuFetch });

      const bridgeFetch = createBridgeFetch();
      const response = asResponse(
        await bridgeFetch(REQUEST_URL, { body: REQUEST_BODY, method: 'POST' }),
      );

      if (response.body === null) {
        throw new Error('재구성된 Response에 body가 없습니다');
      }
      const reader = response.body.getReader();
      const chunk = await reader.read();
      expect(new TextDecoder().decode(chunk.value)).toBe('{"choices":[]}');
    });

    it('globalFetch의 합성 400은 실제 HTTP 응답과 구분해 실패시킨다', async () => {
      const risuFetch = vi.fn().mockResolvedValue(
        createLegacyResult({
          ok: false,
          data: 'blocked by security policy',
          headers: {},
          status: 400,
        }),
      );
      vi.stubGlobal('risuai', { risuFetch });

      const bridgeFetch = createBridgeFetch();
      await expect(
        bridgeFetch(REQUEST_URL, { body: REQUEST_BODY, method: 'POST' }),
      ).rejects.toMatchObject({
        name: BridgeFetchError.name,
        message: 'blocked by security policy',
      });
    });

    it('실제 HTTP 400의 Uint8Array body는 원문 그대로 Response로 재구성한다', async () => {
      const responseBody = '{"error":{"message":"bad request"}}';
      const risuFetch = vi.fn().mockResolvedValue(
        createLegacyResult({
          ok: false,
          data: new TextEncoder().encode(responseBody),
          status: 400,
        }),
      );
      vi.stubGlobal('risuai', { risuFetch });

      const bridgeFetch = createBridgeFetch();
      const response = asResponse(
        await bridgeFetch(REQUEST_URL, { body: REQUEST_BODY, method: 'POST' }),
      );

      expect(response.ok).toBe(false);
      expect(response.status).toBe(400);
      await expect(response.text()).resolves.toBe(responseBody);
    });

    it('risuFetch가 제거된 환경이면 안내 메시지와 함께 실패한다', async () => {
      vi.stubGlobal('risuai', {});

      const bridgeFetch = createBridgeFetch();

      await expect(
        bridgeFetch(REQUEST_URL, { body: REQUEST_BODY, method: 'POST' }),
      ).rejects.toThrow(/현재 버전의 RisuAI를 지원하지 않아요/);
    });

    it('브릿지가 risuFetch not found로 거절해도 같은 안내 메시지로 바꾼다', async () => {
      // 실전의 risuai는 모든 프로퍼티에 함수를 돌려주는 Proxy라, 제거 여부는
      // 호출 거절(API method risuFetch not found)로만 드러난다.
      const risuFetch = vi.fn().mockRejectedValue(new Error('API method risuFetch not found'));
      vi.stubGlobal('risuai', { risuFetch });

      const bridgeFetch = createBridgeFetch();

      await expect(
        bridgeFetch(REQUEST_URL, { body: REQUEST_BODY, method: 'POST' }),
      ).rejects.toThrow(/현재 버전의 RisuAI를 지원하지 않아요/);
    });

    it('abort된 요청은 HTTP 실패 대신 abort 예외로 끝난다', async () => {
      const abortController = new AbortController();
      const risuFetch = vi.fn().mockImplementation(async () => {
        abortController.abort();
        return createLegacyResult({ ok: false, data: 'aborted', status: 400 });
      });
      vi.stubGlobal('risuai', { risuFetch });

      const bridgeFetch = createBridgeFetch();

      await expect(
        bridgeFetch(REQUEST_URL, {
          body: REQUEST_BODY,
          method: 'POST',
          signal: abortController.signal,
        }),
      ).rejects.toThrow(abortController.signal.reason);
    });

    it('POST·GET 외의 메서드는 거부한다', async () => {
      const risuFetch = vi.fn();
      vi.stubGlobal('risuai', { risuFetch });

      const bridgeFetch = createBridgeFetch();

      await expect(
        bridgeFetch(REQUEST_URL, { body: REQUEST_BODY, method: 'DELETE' }),
      ).rejects.toThrow(/DELETE 요청을 지원하지 않습니다/);
      expect(risuFetch).not.toHaveBeenCalled();
    });

    it('계약 밖 형태의 data는 감추지 않고 실패시킨다', async () => {
      const risuFetch = vi
        .fn()
        .mockResolvedValue(createLegacyResult({ data: { unexpected: true } }));
      vi.stubGlobal('risuai', { risuFetch });

      const bridgeFetch = createBridgeFetch();

      await expect(
        bridgeFetch(REQUEST_URL, { body: REQUEST_BODY, method: 'POST' }),
      ).rejects.toThrow(/해석할 수 없는 응답 본문 형태/);
    });
  });
});
