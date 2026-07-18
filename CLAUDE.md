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

## 테스트 원칙

- 테스트는 모듈이 index로 노출한 공개 API만 대상으로 한다. 내부 함수의 구현
  방식은 테스트하지 않는다 — 노출된 인터페이스가 계약대로 동작하는지가 전부다.
- 내부 함수를 테스트하고 싶어지면 그 내부가 독립 모듈로 승격될 신호로 본다.
- 모든 테스트는 중앙 `src/__tests__/`에 둔다. mock은 실제 런타임 semantics를
  따른다 (예: pluginStorage는 동기 read-through — setItem 직후 getItem은 최신값).

## 모듈 구조 원칙

- 디렉터리 모듈의 루트에는 모듈의 목적을 표현하는 "주인공"(공개 오케스트레이션)만
  남기고, 내부 구현은 역할별 서브모듈로 내려보낸다. 폴더를 열었을 때 메인 파일이
  먼저 보이고, 나머지는 서브디렉터리에 숨겨져야 한다.
- 이 원칙은 재귀적이다. 파일이 디렉터리로 확장되는 순간 그 디렉터리는 디렉터리
  모듈이며, 신규·기존 구분 없이 모든 깊이에서 같은 규칙을 적용한다.
- 컴포넌트 모듈은 내부 전용 컴포넌트를 components/ 서브디렉터리로 묶는다.
  모듈 루트에 컴포넌트를 흩뿌리지 않는다.
- 서브디렉터리는 경계(의존·노출·도메인)를 표현할 때만 만든다. 파일 모양이
  비슷하다는 이유만의 장식적 그룹핑은 하지 않는다 — 패밀리는 네이밍 접미사로
  표현한다.
- index.ts는 실소비자가 쓰는 공개 API만 명시적으로 재수출한다 (`export *` 금지,
  테스트 편의용 내부 재수출 금지).
- 한 함수 한 파일은 지향이지 강박이 아니다 — 통과만 하는 wrapper 파일은 만들지
  않고, 외부 소비자가 없는 서브모듈에는 index를 두지 않는다.

## 구조

- `src/plugin.ts` — 엔트리. `risuai.addProvider('LLM Gateway', ...)` 등록 + 요청 오케스트레이션
- `src/bridge-fetch.ts` — 브릿지 경유 FetchLike 생성. transferable streams 미지원 브라우저
  (Safari 26 이하)는 legacy `risuFetch` 폴백으로 자동 전환 (아래 런타임 제약 참고)
- `src/convert.ts` — RisuAI `prompt_chat`(OpenAIChat[]) → llm-io `LlmMessage[]` 변환
- `src/cache.ts` — 캐시 모드/키 + breakpoint 자동 배치(아래 참고) + 앵커 상태 저장
- `src/ledger.ts` — 캐시 손익 원장 (읽기/쓰기 토큰·실 지출 누적, 토큰 등가 손익과 `cost_details` 기반 `savedUsd` 계산)
- `src/options.ts` — 모델 프리셋·서비스 티어·reasoning/verbosity·스트리밍·RisuAI LLM flags 인자
- `src/settings.ts` + `src/theme.ts` + `src/constants.ts` — 설정 UI (인자 편집 + 손익 표시/리셋)
- `src/toast.ts` — 캐시 백오프 발동/해제 메인 DOM 토스트 (`SafeDocument`, 실패 시 경고 폴백)
- `types/risuai.d.ts` — RisuAI 본체 `src/ts/plugins/apiV3/risuai.d.ts` 사본 (갱신 시 재복사.
  본체 d.ts의 JSDoc 정규식 `*/` 버그로 tsc 구문 에러가 나면 예시를 `new RegExp(...)`로 교체)
- `types/risuai-legacy.d.ts` — 본체 d.ts에 없는 deprecated `risuFetch` 선언 (Safari 폴백 전용,
  본체 제거 가능성 때문에 optional로 선언해 존재 확인을 강제)

## breakpoint 자동 배치 (cache.ts)

- 조립된 messages만으론 로어북/채팅 경계를 알 수 없어 **직전 요청과의 양끝 diff**
  (메시지 단위 공통 프리픽스+서픽스)로 삽입 구간을 찾고, 그 끝에 frontier BP를 찍는다.
  공통 서픽스(후행 블록)는 매턴 위치가 밀려 캐시 불가 — 캐시에 태우지 않는다.
- 첫 턴/새 epoch: 마지막 user 롤 직전에 기본 BP. 공통 프리픽스 0(채팅방 전환)이면 epoch 리셋.
- 앵커는 메시지 인덱스 오름차순 배열로 최대 4개를 증분 관리한다. 해시 일치 프리픽스 안의 기존
  앵커만 생존시키고 새 frontier를 추가하며, 분기 이벤트면 일치 경계도 후보로 추가한다.
- 후보가 5개 이상이면 가장 깊은 앵커와 최신 frontier는 보존하고, 누적 추정 토큰 간격이 가장
  좁은 인접 쌍의 내부 앵커를 4개가 될 때까지 제거한다.
- 동일 요청(리롤)은 현재 길이 안의 기존 앵커를 유지하고, 직전 요청의 프리픽스로 축소된 요청은
  첫 턴 정책으로 다시 추정한다.
- **assistant 메시지엔 마킹 금지**: llm-io가 assistant를 문자열 content로 직렬화해
  breakpoint가 와이어에서 유실된다(to-openai-message.ts). 실측에서도 llmgateway는 assistant 지점
  마커를 200으로 수락하지만 1,531토큰 프리픽스의 cache write가 0이라 엔트리를 만들지 않았다.
  system/user로 물러나 마킹.
- 직전 요청은 원문이 아닌 **메시지별 fingerprint(FNV-1a 해시 + 토큰 추정)**로
  `pluginStorage`(`llm-gateway-provider:cache-anchor-state`)에 저장 — 평문 비노출,
  용량 고정, database.bin 동기화를 타고 다른 기기에서도 이어진다.
- 공통 프리픽스 0인 epoch 리셋이 3회 연속이면 explicit breakpoint 마킹을 중단한다.
  diff와 상태 갱신은 계속하며, 프리픽스가 다시 일치하는 턴에 카운터를 0으로 되돌리고 자동 재개한다.
- 토큰 추정: ASCII/4 + 비ASCII/2 + 메시지당 framing 4토큰. 1024토큰 미만 프리픽스는 마킹 생략.
  (후속: 응답 usage.inputTokens 기반 런타임 보정)
- 캐시 처리 실패는 채팅 요청을 죽이지 않고 로그 후 캐시 없이 진행. 손상 상태는 새 epoch로 자가 회복.

## 캐시 손익 원장 (ledger.ts)

- 토큰 등가 순절감은 `0.9 × readTokens − 0.25 × writeTokens`로 표시한다.
- 실측 USD 절감은 일반 입력 토큰의 `input_cost` 단가를 역산한 뒤 캐시 읽기 절감에서 캐시 쓰기 프리미엄을 뺀다.
- `cost_details`가 없거나 일반 입력 토큰이 0이면 해당 응답의 `savedUsd`만 누적하지 않고 읽기/쓰기 토큰은 유지한다.
  `input_cost`/`cached_input_cost`/`cache_write_input_cost` 개별 부재는 0으로 취급한다.
- 구버전 원장의 `costUsd`, `savedUsd`, `lastCostSample`은 Zod 기본값으로 제자리 마이그레이션한다.

## 런타임 환경 / 제약

- **iframe 샌드박스**: CSP `connect-src 'none'` — 네트워크는 `risuai.nativeFetch` 브릿지 경유만 가능.
  브릿지는 `Response`(body ReadableStream transferable 포함)와 `AbortSignal`(ABORT_SIGNAL_REF) 모두 통과시킨다.
- **Safari 폴백 (bridge-fetch.ts)**: transferable streams 미지원 브라우저(Safari 26 이하)에서는
  브릿지의 Response 전달이 DataCloneError("The object can not be cloned")로 실패해 스트리밍 모드와
  무관하게 모든 nativeFetch가 죽는다 (Safari 27 beta부터 지원). 요청 전에 MessageChannel probe로
  지원 여부를 감지해, 미지원이면 legacy `risuFetch(rawResponse:true, plainFetchForce:true)`로 받은
  `Uint8Array`를 iframe 안에서 `new Response(...)`로 재구성한다. **전송 실패 후 재시도는 중복 과금
  위험이 있어 금지** — 반드시 요청 전에 경로를 결정한다. decoupled 모드는 이 경로에서
  buffered-decoupled로 동작한다 (연결은 스트리밍, 소비는 완료 후 일괄).
  `plainFetchForce`인 이유: fetchNative가 NodeOnly에서 직접 fetch로 동작하므로 폴백도 같은 직접
  경로로 통일한다. llmgateway.io는 `Access-Control-Allow-Origin: *`라 공식 웹·Tauri에서도 통과한다.
  headers의 content-type은 반드시 `Content-Type` 표기 하나로 정규화한다 — globalFetch가 대문자
  기본값을 별도 키로 추가해 중복되면 게이트웨이가 body를 빈 객체로 취급한다 (실측 HTTP 400 ZodError).
- **프로바이더 인자 실체**: `ProviderArguments`의 샘플러 값들은 d.ts와 달리 런타임에 누락될 수 있다
  (RisuAI `applyParameters`가 -1000 "off" 값을 skip). llm-io가 undefined를 omit하므로 그대로 통과시킨다.
- **temperature 스케일**: RisuAI가 이미 /100 해서 API 스케일(0~2)로 넘겨준다. 추가 변환 금지.
- **penalty 스케일**: frequency/presence penalty도 RisuAI가 이미 /100 해서 넘겨준다. `extraBody`에 그대로 전달한다.
- **max_tokens**: llm-io ChatCompletions 포맷이 `max_completion_tokens`로 직렬화한다 (GPT-5.6 대응).
- **reasoning/verbosity 경로**: RisuAI는 플러그인 provider 인자를 하드코딩해 두 값을 전달하지 않는다.
  플러그인 인자에서 읽어 llm-io `OpenAIChatCompletionsExtraBody`로 보내는 경로가 유일하다.
- **스트리밍 등록 스냅샷**: `streaming_mode`와 flags는 플러그인 로드 때 읽어 provider 동작과
  model metadata를 함께 고정한다. 설정 변경 후에는 새로고침이 필요하다.
- **LLMFlags 숫자 동기화**: `src/options.ts`의 이름→숫자 매핑은 RisuAI
  `src/ts/model/types.ts`의 `LLMFlags`가 출처다. 본체 값 변경 시 반드시 함께 갱신한다.
- **tokenizer**: legacy custom 경로용 addProvider top-level `o200k_base`와 V3 모델 메타용
  `LLMTokenizer.tiktokenO200Base`(2)를 함께 지정한다.
- **esbuild IIFE**: RisuAI가 플러그인 코드를 `(async () => { ... })()`로 인라인하므로 ESM 불가.
  top-level await도 IIFE 포맷에서 빌드 에러 — `void main()` 패턴 사용.
- **권한 팝업**: 첫 프로바이더 호출 시 유저 승인을 요청하고 3일 주기로 재확인한다.
  거부 미차단 본체 버그는 아래 알려진 제한 참고.
- **백오프 토스트**: 플러그인 v3에 전용 토스트 API가 없어 `risuai.getRootDocument()`의
  `SafeDocument` 메서드로 메인 DOM에 주입한다. 권한 거부·API 부재는 `console.warn` 후 요청을 계속한다.

## 스코프 결정

- **ChatCompletions 단일 경로**: llm-io `LLMGatewayProvider`가 `openai-chat-completions`(→ `/chat/completions`)와
  `anthropic-messages`(→ `/messages`)만 라우팅한다. OpenAIResponses는 `throwUnsupportedFormat`.
  llmgateway.io 서비스 자체는 `/v1/responses`를 지원하므로(Codex CLI 가이드, 데이터 보존 설정 필요),
  Responses 지원은 llm-io에 경로 매핑을 추가하면 가능 — 보류 상태.
- **스트리밍 2모드**: `off`는 `generate()`, `decoupled`는 `stream()`을 끝까지 소비한 완성 문자열을
  반환한다. streaming usage와 앵커 상태는 완료 시 반영한다. 과거 `stream` 저장값은 `decoupled`로 정규화한다.
- **미디어 flags 비활성화**: `convert.ts`가 텍스트 전용이므로 Image/Audio/Video flags는 설정 UI에서
  disabled 상태다. 멀티모달 변환 구현 전 활성화하면 데이터가 조용히 유실될 수 있다.

## 알려진 제한

- 캐시 원장과 앵커 상태는 read-modify-write가 비원자적이라 동시 요청 시 갱신이 유실될 수 있다.
  RisuAI의 `doingChat` 락으로 실사용 채팅 요청은 순차 실행되므로 별도 잠금은 두지 않는다.
- decoupled 소비 루프는 body chunk 사이에서 abort를 확인해 중단하고 앵커·원장을 저장하지 않는다.
  다만 헤더 수신 뒤 abort가 본체 브릿지의 response body까지 전달되지 않아, 다음 chunk가 오기 전까지
  `reader.read()`를 즉시 깨우지 못한다.
- RisuAI 본체의 provider 권한 확인은 반환값을 무시해 사용자가 권한을 거부해도 호출을 차단하지 않는다.
- RisuAI 본체의 `customV3ProviderMetaStore`는 재활성화 때 이전 메타를 제거하지 않고 누적한다.
  옛 flags가 계속 사용될 수 있으므로 설정 변경 적용은 플러그인 재활성화가 아니라 새로고침을 사용한다.

## Git

- 커밋 시 `/commit-with-context`를 사용하여 의사결정 컨텍스트를 보존한다.
