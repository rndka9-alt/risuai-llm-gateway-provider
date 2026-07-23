/**
 * RisuAI 본체가 v3 타입 정의(risuai.d.ts)에 노출하지 않는 legacy API 선언.
 *
 * risuFetch는 deprecated지만 v3 런타임에 여전히 브릿지되어 있다
 * (본체 src/ts/plugins/apiV3/v3.svelte.ts). LLM Gateway 요청은 server-side proxy를
 * 보장해야 하며 최신 nativeFetch에는 외부 URL의 proxy 강제 옵션이 없어 이 API를 쓴다.
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
      /** true면 전역 "직접 요청 보내기" 설정을 무시하고 플랫폼의 server-side 경로를 쓴다. */
      plainFetchDeforce?: boolean;
      abortSignal?: AbortSignal;
    },
  ): Promise<{
    ok: boolean;
    data: unknown;
    headers: Record<string, string>;
    status: number;
  }>;
}
