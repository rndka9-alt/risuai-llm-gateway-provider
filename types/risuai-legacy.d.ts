/**
 * RisuAI 본체가 v3 타입 정의(risuai.d.ts)에 노출하지 않는 legacy API 선언.
 *
 * risuFetch는 deprecated지만 v3 런타임에 여전히 브릿지되어 있다
 * (본체 src/ts/plugins/apiV3/v3.svelte.ts). transferable streams를 지원하지
 * 않는 브라우저(Safari 26 이하)에서는 nativeFetch의 Response(body ReadableStream)
 * 전달이 DataCloneError로 실패해, 순수 객체를 반환하는 이 API를 폴백으로 쓴다.
 * 본체에서 제거될 수 있으므로 optional로 선언해 호출 전 존재 확인을 강제한다.
 */
interface RisuaiPluginAPI {
  risuFetch?(
    url: string,
    options?: {
      body?: unknown;
      headers?: Record<string, string>;
      method?: 'POST' | 'GET';
      /** true면 data가 응답 본문 전체의 Uint8Array로 온다. 끄면 JSON 파싱을 시도한다. */
      rawResponse?: boolean;
      /** true면 프록시 경유 없이 브라우저 fetch로 직접 요청한다. */
      plainFetchForce?: boolean;
      abortSignal?: AbortSignal;
    },
  ): Promise<{
    ok: boolean;
    data: unknown;
    headers: Record<string, string>;
    status: number;
  }>;
}
