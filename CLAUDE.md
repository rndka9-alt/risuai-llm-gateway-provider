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

- `src/plugin.ts` — 엔트리. `risuai.addProvider('LLM Gateway', ...)` 등록 + 요청 오케스트레이션
- `src/convert.ts` — RisuAI `prompt_chat`(OpenAIChat[]) → llm-io `LlmMessage[]` 변환
- `src/cache.ts` — 캐시 모드/키 + breakpoint 자동 배치(아래 참고) + 앵커 상태 저장
- `src/ledger.ts` — 캐시 손익 원장 (읽기/쓰기 토큰 누적, 0.9R − 0.25W 순절감 계산)
- `src/options.ts` — 모델 프리셋(sol/terra/luna)·서비스 티어 인자
- `src/settings.ts` + `src/theme.ts` + `src/constants.ts` — 설정 UI (인자 편집 + 손익 표시/리셋)
- `types/risuai.d.ts` — RisuAI 본체 `src/ts/plugins/apiV3/risuai.d.ts` 사본 (갱신 시 재복사.
  본체 d.ts의 JSDoc 정규식 `*/` 버그로 tsc 구문 에러가 나면 예시를 `new RegExp(...)`로 교체)

## breakpoint 자동 배치 (cache.ts)

- 조립된 messages만으론 로어북/채팅 경계를 알 수 없어 **직전 요청과의 양끝 diff**
  (메시지 단위 공통 프리픽스+서픽스)로 삽입 구간을 찾고, 그 끝에 frontier BP를 찍는다.
  공통 서픽스(후행 블록)는 매턴 위치가 밀려 캐시 불가 — 캐시에 태우지 않는다.
- 첫 턴/새 epoch: 마지막 user 롤 직전에 기본 BP. 공통 프리픽스 0(채팅방 전환)이면 epoch 리셋.
- 분기 이벤트 시 가장 얕은 일치 경계를 폴백 앵커로 유지 (BP 최대 2개).
- **assistant 메시지엔 마킹 금지**: llm-io가 assistant를 문자열 content로 직렬화해
  breakpoint가 와이어에서 유실된다(to-openai-message.ts). system/user로 물러나 마킹.
- 직전 요청은 원문이 아닌 **메시지별 fingerprint(FNV-1a 해시 + 토큰 추정)**로
  `pluginStorage`(`llm-gateway-provider:cache-anchor-state`)에 저장 — 평문 비노출,
  용량 고정, database.bin 동기화를 타고 다른 기기에서도 이어진다.
- 토큰 추정: ASCII/4 + 비ASCII/2 + 메시지당 framing 4토큰. 1024토큰 미만 프리픽스는 마킹 생략.
  (후속: 응답 usage.inputTokens 기반 런타임 보정)
- 캐시 처리 실패는 채팅 요청을 죽이지 않고 로그 후 캐시 없이 진행. 손상 상태는 새 epoch로 자가 회복.

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
