# risuai-llm-gateway-provider

RisuAI Plugin API v3.0 기반 커스텀 프로바이더 플러그인.
llmgateway.io 단일 프로바이더만 핀포인트로 지원하며, 요청 인터페이스는 llm-io(GitHub 의존성)를 사용한다.

## 빌드 / 릴리즈

```bash
npm run build     # esbuild(TS→JS 번들) + terser(minify) → plugin.min.js
npm run typecheck
npm test
./release.sh      # 버전 범프 → 빌드 → 커밋 → 태그 → push → GitHub Release
```

`plugin.min.js`의 `@version`은 빌드 시 `package.json`에서 읽는다. 버전은 `package.json`에서만 관리하고,
`npm run build` 후 수동 커밋으로 배포하지 않는다 (release.sh 일괄 처리).

## 구조

- `src/plugin.ts` — 엔트리. `risuai.addProvider('LLM Gateway', ...)` 등록
- `src/convert.ts` — RisuAI `prompt_chat`(OpenAIChat[]) → llm-io `LlmMessage[]` 변환
- `types/risuai.d.ts` — RisuAI 본체 `src/ts/plugins/apiV3/risuai.d.ts` 사본 (갱신 시 재복사)

## 런타임 환경 / 제약

- **iframe 샌드박스**: CSP `connect-src 'none'` — 네트워크는 `risuai.nativeFetch` 브릿지 경유만 가능.
  브릿지는 `Response`(body ReadableStream transferable 포함)와 `AbortSignal`(ABORT_SIGNAL_REF) 모두 통과시킨다.
- **프로바이더 인자 실체**: `ProviderArguments`의 샘플러 값들은 d.ts와 달리 런타임에 누락될 수 있다
  (RisuAI `applyParameters`가 -1000 "off" 값을 skip). llm-io가 undefined를 omit하므로 그대로 통과시킨다.
- **temperature 스케일**: RisuAI가 이미 /100 해서 API 스케일(0~2)로 넘겨준다. 추가 변환 금지.
- **max_tokens**: llm-io ChatCompletions 포맷이 `max_completion_tokens`로 직렬화한다 (GPT-5.6 대응).
- **esbuild IIFE**: RisuAI가 플러그인 코드를 `(async () => { ... })()`로 인라인하므로 ESM 불가.
  top-level await도 IIFE 포맷에서 빌드 에러 — `void main()` 패턴 사용.
- **권한 팝업**: 첫 프로바이더 호출 시 유저 승인 필요 (3일 주기 재확인).

## 스코프 결정

- **ChatCompletions 단일 경로**: llm-io `LLMGatewayProvider`가 `openai-chat-completions`(→ `/chat/completions`)와
  `anthropic-messages`(→ `/messages`)만 라우팅한다. OpenAIResponses는 `throwUnsupportedFormat`.
  llmgateway.io 서비스 자체는 `/v1/responses`를 지원하므로(Codex CLI 가이드, 데이터 보존 설정 필요),
  Responses 지원은 llm-io에 경로 매핑을 추가하면 가능 — 보류 상태.
- **논스트리밍 v1**: 브릿지가 스트림을 통과시키므로 `llm.streamText` 기반 스트리밍이 기술적으로 가능. 추후 작업.
- **frequency/presence penalty 미전달**: llm-io `LlmRequestOptions`가 maxTokens/temperature/topP만 노출.
  필요해지면 `extraBody`로 전달.

## Git

- 커밋 시 `/commit-with-context`를 사용하여 의사결정 컨텍스트를 보존한다.
