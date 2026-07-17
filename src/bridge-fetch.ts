import type { FetchLike } from 'llm-io';

interface BridgeFetchOptions {
  /** 테스트나 런타임 교체용 transferable streams 감지 결과 오버라이드입니다. */
  transferableStreamsSupported?: boolean;
}

const LEGACY_FALLBACK_UNAVAILABLE_MESSAGE =
  '이 브라우저는 transferable streams를 지원하지 않아 risuFetch 폴백이 필요하지만, ' +
  '현재 RisuAI에서 deprecated risuFetch API가 제거되어 요청을 보낼 수 없습니다. ' +
  'Safari 27 이상 또는 Chrome/Firefox에서 사용해주세요.';

let cachedTransferableStreamsSupport: boolean | undefined;

function supportsTransferableStreams(): boolean {
  if (cachedTransferableStreamsSupport !== undefined) {
    return cachedTransferableStreamsSupport;
  }
  // 전용 MessageChannel 안에서만 오가므로 RisuAI 브릿지(window message)에는 닿지 않는다.
  // transferable 지원은 브라우저 엔진 레벨 속성이라, iframe 안에서 찔러본 결과가
  // 호스트→iframe으로 Response body를 전송할 때의 성공 여부와 일치한다.
  const probeStream = new ReadableStream();
  const channel = new MessageChannel();
  try {
    channel.port1.postMessage(probeStream, [probeStream]);
    cachedTransferableStreamsSupport = true;
  } catch {
    // Safari 26 이하는 transfer 목록의 스트림에 동기로 DataCloneError를 던진다.
    // 이 실패가 곧 감지 결과다.
    cachedTransferableStreamsSupport = false;
  } finally {
    channel.port1.close();
    channel.port2.close();
  }
  return cachedTransferableStreamsSupport;
}

// Response 생성자는 이 상태 코드들에 body를 넣으면 TypeError를 던진다.
const NULL_BODY_STATUSES = new Set([204, 205, 304]);

function normalizeLegacyHeaders(headers: Record<string, string>): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    // globalFetch가 'Content-Type' 표기로 자체 기본값을 병합하므로, llm-io의 소문자
    // content-type이 그대로 가면 두 키가 공존해 최종 헤더가
    // 'application/json, application/json'으로 합쳐진다. 엄격한 JSON 파서(게이트웨이)는
    // 이를 비JSON으로 판정해 body를 빈 객체로 취급한다 (실측 HTTP 400 ZodError 유력 원인).
    normalized[name.toLowerCase() === 'content-type' ? 'Content-Type' : name] = value;
  }
  return normalized;
}

function toLegacyResponseBody(data: unknown): Uint8Array<ArrayBuffer> | string {
  // rawResponse:true 성공 경로는 본문 전체 Uint8Array, globalFetch 내부 오류 경로는
  // 메시지 문자열을 준다. 그 외 형태는 계약 밖이므로 감추지 않고 실패시킨다.
  if (data instanceof Uint8Array) {
    // 타입상 SharedArrayBuffer 기반일 수 있어 BodyInit에 바로 못 넣는다 —
    // ArrayBuffer 기반 사본으로 옮긴다.
    const copied = new Uint8Array(data.byteLength);
    copied.set(data);
    return copied;
  }
  if (typeof data === 'string') {
    return data;
  }
  throw new Error(`risuFetch 폴백이 해석할 수 없는 응답 본문 형태입니다: ${typeof data}`);
}

const legacyRisuFetch: FetchLike = async (url, init) => {
  // JSON.parse나 폴백 안내 에러가 abort보다 먼저 나가지 않도록 진입 시점에 확인한다.
  init?.signal?.throwIfAborted();
  const risuFetch = risuai.risuFetch;
  if (risuFetch === undefined) {
    throw new Error(LEGACY_FALLBACK_UNAVAILABLE_MESSAGE);
  }
  const method = init?.method;
  if (method !== undefined && method !== 'POST' && method !== 'GET') {
    throw new Error(`risuFetch 폴백은 ${method} 요청을 지원하지 않습니다.`);
  }
  let result;
  try {
    result = await risuFetch(url, {
      // globalFetch가 body를 다시 JSON.stringify하므로, llm-io가 직렬화한 JSON 문자열을
      // 그대로 넘기면 이중 인코딩된다 — 파싱해 원래 값으로 되돌려 전달한다.
      ...(init?.body === undefined ? {} : { body: JSON.parse(init.body) }),
      ...(init?.headers === undefined ? {} : { headers: normalizeLegacyHeaders(init.headers) }),
      ...(method === undefined ? {} : { method }),
      // 끄면 SSE·오류 본문이 globalFetch의 JSON 파싱 경로로 들어가 깨진다.
      rawResponse: true,
      // nativeFetch(fetchNative)가 NodeOnly에서 직접 fetch로 동작하므로 폴백도 같은
      // 직접 경로로 통일한다. llmgateway.io는 Access-Control-Allow-Origin: *라
      // 공식 웹·Tauri의 브라우저 직접 요청도 통과한다.
      plainFetchForce: true,
      ...(init?.signal === undefined ? {} : { abortSignal: init.signal }),
    });
  } catch (error) {
    // 게스트의 risuai는 모든 프로퍼티에 함수를 돌려주는 Proxy라 위 존재 확인은
    // 실전에서 걸리지 않는다. 본체에서 risuFetch가 제거되면 브릿지가
    // 'API method risuFetch not found'로 거절하므로 여기서 안내 메시지로 바꾼다.
    if (error instanceof Error && error.message.includes('risuFetch not found')) {
      throw new Error(LEGACY_FALLBACK_UNAVAILABLE_MESSAGE);
    }
    throw error;
  }
  // globalFetch는 abort를 throw 없이 {ok:false, status:400}으로 반환하므로,
  // HTTP 실패로 오인되기 전에 표준 abort 예외로 되돌린다.
  init?.signal?.throwIfAborted();
  return new Response(
    NULL_BODY_STATUSES.has(result.status) ? null : toLegacyResponseBody(result.data),
    {
      status: result.status,
      headers: result.headers,
    },
  );
};

/**
 * RisuAI 브릿지를 건너는 FetchLike를 만든다.
 *
 * 브릿지는 nativeFetch의 Response body를 ReadableStream transfer로 iframe에
 * 돌려주는데, transferable streams 미지원 브라우저(Safari 26 이하)에서는 이 전송이
 * DataCloneError로 실패해 스트리밍 모드와 무관하게 모든 요청이 죽는다.
 * 전송 실패 시점엔 과금 요청이 이미 실행된 뒤라 사후 재시도는 중복 과금 위험이
 * 있으므로, 반드시 요청 전에 지원 여부를 감지해 경로를 고른다.
 */
export function createBridgeFetch(options?: BridgeFetchOptions): FetchLike {
  const transferableStreamsSupported =
    options?.transferableStreamsSupported ?? supportsTransferableStreams();
  if (transferableStreamsSupported) {
    return (url, init) => risuai.nativeFetch(url, init);
  }
  return legacyRisuFetch;
}
