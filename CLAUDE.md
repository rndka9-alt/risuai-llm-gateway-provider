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

### 기능 테스트와 캐싱 효율 측정(sim)의 분리

테스트는 검증 대상이 "동작이 계약대로인가"(기능)와 "캐시 정책이 얼마나 절감하는가"(효율)로
나뉘며, 실행 경로도 분리한다.

```bash
npm test          # 기능·계약 테스트 (sim 제외) — 기본 실행 경로
npm run test:sim  # 캐싱 효율 측정 (src/__tests__/sim/) — 캐시 정책 변경 시에만
npm run test:all  # 둘 다
```

- `src/__tests__/sim/`은 cache hit simulator 위에서 canonical scenario를 replay해 정책별 절감
  토큰을 집계하는 벤치마크 하네스다. 정책 × 시나리오 × cache hit simulator 조합이라 실행
  시간이 기능 테스트의 10배를 넘으므로(실측 21초 vs 2초) 기본 `npm test`에서 제외한다.
- **캐싱 효율을 측정·비교할 때만** `npm run test:sim`을 쓴다. 대상은 `src/cache/`의 breakpoint
  배치·앵커 선택·축출 규칙, `ledger/savings.ts`의 손익 산식처럼 절감량 자체를 바꾸는 변경이다.
  이 경로를 건드리지 않는 변경은 `npm test`로 충분하다.
- sim은 실험 기록인 동시에 회귀망이다. `v013-single-slot.test.ts`는 기대 점수를 고정해 두므로
  정책을 의도적으로 바꿨다면 점수 갱신이 함께 필요하다.

### sim 결과 해석 원칙

- 정책 비교는 전체 합산·평균이 아니라 **scenario별 증감률(net/input, pp)**로 판단한다.
  scenario마다 입력 토큰 총량이 달라 합산 net/input은 토큰이 큰 scenario가 지배하고,
  특정 워크로드의 퇴행이 전체 개선 수치에 가려진다. (실례: TTL-aware admission의 전체
  +3.24pp는 사실상 TTL 밖 회전·unique churn에서 왔고, within-TTL eight-fast에서는
  −3.9pp 퇴행이 숨어 있었다.)
- 순절감(net)만 보지 않고 read/write를 분해해서 본다. 같은 net이라도 "히트 유지"와
  "write 낭비 절감"은 전략적 의미가 다르다.
- 기준선은 두 층을 함께 둔다: 현행 production("지금보다 나은가")과 직전 릴리즈 실배포
  정책("이전 릴리즈보다 퇴행하지 않는가", 예: `v013-single-slot`). 릴리즈 안전선은
  assertion으로 고정한다.
- 짧은 horizon(36요청)은 admission류 정책의 학습비 회수 구간을 놓친다. 재등장 주기가 긴
  scenario는 회수 구간을 포함한 long 변형(96요청 등)을 함께 둔다.
- 새 정책 후보는 스코어를 믿기 전에 adversarial scenario(전략의 가정을 정면으로 찌르는
  패턴)로 먼저 흔들어 본다. oracle 정책의 수치는 구조를 미리 아는 상한선이며 실구현
  예상치가 아니다.

### sim 내부 구조

- 공용 headless API·cache backend·replay·JSON CLI는 `llm-cache-simulator` package를 사용한다.
  `production-v016` preset은 고정 비교군이며 provider HEAD 정책을 대신하지 않는다.
- `src/__tests__/sim/adapters/` — provider HEAD의 production cache planner를 package 계약에
  연결한다. policy 인스턴스는 cache snapshot을 closure에 유지하며 RisuAI storage나
  global을 사용하지 않는다.
- `src/__tests__/sim/scenarios/` — 테스트 입력 시나리오의 공개 진입점과 canonical·long-run·neutral 구성
- `src/__tests__/sim/cache-strategies/` — breakpoint·cache key·admission을 결정하는 현행·과거·실험 전략
- `src/__tests__/sim/reporting/` — scoreboard 등 결과 표현
- `src/__tests__/sim/suites/` — golden 회귀와 eviction 비교 스위트
- `src/__tests__/sim/experiments/` — 아직 현행 정책이나 공통 회귀망으로 승격되지 않은 탐구성 실험

소비자는 `scenarios` 폴더 경로로 import한다. `scenarios/index.ts`에는 `scenarios.ts`의
공개 심볼을 named re-export하는 선언만 두고, 폴더명과 같은 `scenarios/scenarios.ts`가
모듈의 주인공 역할을 맡는다. 시나리오는 요청 메시지·시간 간격·식별자처럼 replay할 입력만
소유하고, cache hit simulator·정책·assertion·report는 소유하지 않는다.
구현은 `scenarios/internal/` 아래 canonical·long-run·neutral로 나눈다. `suites/golden/`은
이 입력에 고정 기대값을 적용하는 golden 회귀 테스트이며, 시나리오 자체의 분류가 아니다.

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

- `src/plugin.ts` — 엔트리. 부팅과 `risuai.addProvider('LLM Gateway', ...)` 등록
- `src/provider/` — 요청 오케스트레이션. extraBody 조립과 클라이언트 생성은 `request-llm-gateway.ts`,
  decoupled 스트림 소비는 `consume-gateway-stream.ts`, 성공 응답 뒤 캐시·원장 커밋은
  `complete-successful-request.ts`가 맡는다
- `src/bridge-fetch.ts` — RisuAI의 server-side 경로를 강제하는 FetchLike 생성.
  legacy `risuFetch`의 raw bytes 응답을 iframe 안에서 Response로 재구성 (아래 런타임 제약 참고)
- `src/failure-content/` — 실제 HTTP 오류와 브릿지 합성 오류를 구분하되 원본 body를 보존해 표시.
  `error-codes.ts`가 사용자 실패 안내의 `LGP:ERR:NNN` 코드 레지스트리이고, 민감값 마스킹을 포함한
  오류 직렬화는 `internal/`이 담당한다
- `src/convert.ts` — RisuAI `prompt_chat`(OpenAIChat[]) → llm-io `LlmMessage[]` 변환
- `src/cache/` — 캐시 모드/키 + breakpoint 자동 배치(아래 참고) + 앵커 상태 저장
- `src/ledger/` — 캐시 손익 원장 (읽기/쓰기 토큰·실 지출 누적, 토큰 등가 손익과 `cost_details` 기반 `savedUsd` 계산).
  손익 산식은 `savings.ts`, 영속화는 `storage.ts`, 설정 UI가 구독하는 런타임 snapshot은 `snapshot.ts`가 맡는다
- `src/options/` — 모델 프리셋·서비스 티어·reasoning/verbosity·스트리밍·RisuAI LLM flags 인자.
  관심사별 파일(`model`, `reasoning-effort`, `verbosity`, `streaming-mode`, `service-tier`, `llm-flags`)로 나뉜다
- `src/json-editor/` — 스키마 기반 JSON 에디터 코어 (구문·스키마 진단, breadcrumb, 자동완성, format).
  UI 독립 — (text, offset)만 주고받는다. zod 스키마(`zod/v4` 서브패스) 하나에서 검증(safeParse)과
  자동완성(toJSONSchema → vscode-json-languageservice)을 모두 파생한다. `request-body-schema.ts`는
  GPT-5.6 × llmgateway.io 한정 요청 body 스키마 — 느슨한 Gateway ingress를 복제하지 않고 실제
  의미 있는 요청만 허용하며, `.describe()`가 자동완성 문서로 노출된다
- `src/extra-body.ts` — 설정의 커스텀 요청 body(JSON, config `extra_body`)를 요청 직전 extraBody에
  deep merge (겹치는 필드는 커스텀 우선, invalid JSON이면 그 요청에서는 통째로 무시). 편집 UI는
  설정 패널의 RequestBodyField (json-editor 소비자)
- `src/settings/` — 설정 UI (인자 편집 + 손익 표시/리셋)
- `src/theme/` — 설정 UI가 쓰는 RisuAI 컬러스킴 적용과 프리셋 폴백
- `src/toast.ts` — 캐시 백오프 발동/해제 메인 DOM 토스트 (`SafeDocument`, 실패 시 경고 폴백)
- `types/risuai.d.ts` — RisuAI 본체 `src/ts/plugins/apiV3/risuai.d.ts` 사본 (갱신 시 재복사.
  본체 d.ts의 JSDoc 정규식 `*/` 버그로 tsc 구문 에러가 나면 예시를 `new RegExp(...)`로 교체)
- `types/risuai-legacy.d.ts` — 본체 d.ts에 없는 deprecated `risuFetch`와 `plainFetchDeforce`
  선언 (본체 제거 가능성 때문에 optional로 선언해 존재 확인을 강제)

## 사용자 오류 코드

`LGP:ERR:NNN`은 사용자 제보와 옛 스크린샷을 장기간 식별하는 지원 계약이다.
배포된 코드는 삭제·재번호·재사용하지 않고 `src/failure-content/error-codes.ts`에 새 코드만 추가한다.
대역은 0xx 플러그인 내부·설정, 1xx RisuAI 브릿지·전송, 2xx Gateway HTTP,
3xx Gateway 응답 내용·스트림으로 구분한다.

상세 진단이 있는 실패는 `자세한 오류 정보 (LGP:ERR:NNN)` 타이틀에 표시하고,
HTTP status가 있으면 같은 괄호에 `, 오류 코드 N`을 이어 붙인다. 상세 블록이 없는
실패는 첫 문장에 코드를 표시한다.

| 코드          | 의미                            | 트리거 조건                                                       |
| ------------- | ------------------------------- | ----------------------------------------------------------------- |
| `LGP:ERR:001` | API 키 미설정                   | 저장된 API 키를 trim한 결과가 빈 문자열                           |
| `LGP:ERR:002` | 플러그인 내부 처리 실패         | 다른 분류에 속하지 않은 요청 처리 예외                            |
| `LGP:ERR:101` | RisuAI 브릿지·전송 실패         | `BridgeFetchError`                                                 |
| `LGP:ERR:102` | 플러그인 저장소 캐시 접근 실패  | prepare의 storage 격리 블록에서 pluginStorage 예외 (요청 전송 전) |
| `LGP:ERR:201` | Gateway 요청 스키마 검증 실패   | HTTP 400 body의 `error.name`이 `ZodError`                          |
| `LGP:ERR:202` | Gateway HTTP 처리 실패          | `LGP:ERR:201`을 제외한 `LlmHttpError`                              |
| `LGP:ERR:301` | Gateway in-band 응답 오류       | HTTP 성공 응답 안에서 `LlmInBandError` 발생                       |
| `LGP:ERR:302` | 빈 스트림의 reasoning 한도 소진 | `finishReason=length`이고 reasoning delta 또는 usage token이 존재 |
| `LGP:ERR:303` | 이벤트 없는 빈 스트림           | 본문이 없고 정규화된 stream event가 0개                           |
| `LGP:ERR:304` | 본문 없는 스트림 완료           | `LGP:ERR:302`가 아니며 stream event는 있지만 text delta가 0개     |

## breakpoint 자동 배치 (`src/cache/`)

- 조립된 messages만으론 로어북/채팅 경계를 알 수 없어 **직전 요청과의 양끝 diff**
  (메시지 단위 공통 프리픽스+서픽스)로 삽입 구간을 찾고, 그 끝에 frontier BP를 찍는다.
  공통 서픽스(후행 블록)는 매턴 위치가 밀려 캐시 불가 — 캐시에 태우지 않는다.
- `src/cache/state/bank/select-cache-anchor-bank-state.ts`의 **content-addressed 그룹 뱅크**가
  방 식별자 없이 메시지 fingerprint의 최장 공통 프리픽스로 상태를 고른다. 동률은 MRU 그룹이 이긴다.
  캐시 가능한 요청은 공통 프리픽스가 1,024 추정 토큰 이상일 때만 채택한다. 다만 요청 전체가
  1,024 토큰 미만이면 1개 메시지 이상 일치한 그룹을 채택하고, 불일치해도 bank miss를 늘리지 않는다.
- 그룹을 찾지 못하면 새 그룹의 마지막 user 롤 직전을 frontier로 잡는다. 그룹의 fingerprint·앵커·
  admission·frontier 사망 카운터만 저장하며 프롬프트 원문과 방 식별자는 저장하지 않는다.
- 채택한 그룹의 공통 프리픽스가 직전 frontier보다 얕고 리롤이 아니면 새 그룹으로 fork한다.
  공통 프리픽스 안에서 생존한 앵커와 admission은 그대로 승계하고 frontier 사망 카운터는 0으로
  시작한다. 원본 그룹은 상태와 LRU 순서를 모두 보존한다. 동일 길이 리롤은 기존 그룹을 제자리 갱신한다.
- 앵커는 메시지 인덱스 오름차순 배열로 최대 4개를 증분 관리한다. 해시 일치 프리픽스 안의 기존
  앵커만 생존시키고 새 frontier를 추가하며, 분기 이벤트면 일치 경계도 후보로 추가한다.
- **선택적 admission**: 16,384 추정 토큰 이하의 일반 첫 턴·append·in-place 후보는 즉시 BP로
  마킹해 read 이익을 유지한다. 기존 frontier를 죽이는 구조적 성장·수축·시프트 후보는 두 번의
  요청 전이를 연속 생존한 뒤에만 admission한다. 기존 마킹 프리픽스에서 한 번에 16,384 토큰을
  넘는 확장도 같은 검증을 통과하면 admission해, 큰 안정 구간을 영구 보류하지 않는다. 전면 검증형 구버전의
  `requiresValidation` 없는 상태는 `true`로 읽어, 이미 관찰 중이던 후보를 갑자기 마킹하지 않는다.
- 후보가 5개 이상이면 가장 깊은 앵커와 최신 frontier는 보존하고, 누적 추정 토큰 간격이 가장
  좁은 인접 쌍의 내부 앵커를 4개가 될 때까지 제거한다.
- 동일 요청(리롤)은 현재 길이 안의 기존 앵커를 유지하고, 직전 요청의 프리픽스로 축소된 요청은
  첫 턴 정책으로 다시 추정한다.
- **assistant 메시지엔 마킹 금지**: llm-io가 assistant를 문자열 content로 직렬화해
  breakpoint가 와이어에서 유실된다(to-openai-message.ts). 실측에서도 llmgateway는 assistant 지점
  마커를 200으로 수락하지만 1,531토큰 프리픽스의 cache write가 0이라 엔트리를 만들지 않았다.
  system/user로 물러나 마킹.
- `src/cache/state/bank/cache-anchor-bank-store.ts`는 최대 16개 그룹을 LRU로 관리한다. 작은 index는
  `llm-gateway-provider:cache-anchor-state`에, 그룹 상태는 같은 키의 `:<slot>` 샤드에 저장한다.
  레거시 단일 상태가 index 키에 있으면 첫 그룹으로 읽어 들여 다음 성공 응답 commit에서 한 번 이식한다.
  런타임 snapshot은 영속 쓰기가 모두 성공한 뒤에만 갱신한다.
- 만석에서 새 그룹을 넣을 때는 앵커가 1개 이하인 그룹 중 가장 오래된 것을 먼저 축출하고, 없으면
  순수 LRU 꼬리를 축출한다. fork 원본은 해당 요청의 축출 대상에서 제외한다.
- 어느 그룹과도 매치되지 않는 bank miss가 3회 연속이면 explicit breakpoint 마킹을 중단한다.
  백오프 중 추가 miss는 직전 miss 슬롯을 덮어써 오염을 한 그룹으로 제한한다. 그룹 매치 시 카운터를
  0으로 되돌리고 마킹을 자동 재개한다. 전체가 1,024 토큰 미만인 요청은 miss 연속 횟수에 포함하지 않으며,
  만석 bank에서는 실그룹을 축출하지 않고 해당 요청의 상태 저장을 생략한다.
- `src/cache/prepare-prompt-cache-request.ts`는 선택과 계획만 pending commit에 담고,
  `src/cache/commit-prompt-cache-state.ts`가 성공 응답 뒤 변경 그룹과 index만 영속화한다.
- **후방 안전장치인 위치 판별형 2-strike frontier 모니터**: frontier가 구조적으로 죽는 턴(성장·수축, 또는
  같은 개수인데 분기점 메시지가 직전 요청의 더 뒤 인덱스에 있는 시프트=트림)이 2연속이면
  새 frontier 마킹만 보류한다. 얕은 안정 앵커는 계속 마킹해 read를 유지하고(실측 계약상
  히트는 현재 요청 marker와 entry의 exact 일치에서만 발생), 어차피 죽을 심층 write
  프리미엄만 차단한다. 같은 개수의 제자리 교체(리롤·in-place 수정·churn)는 스트라이크를
  세지 않으며, frontier가 살아남는 턴에 리셋·자동 재개한다. 사망 카운터는 anchor state에
  실려 성공 응답 후에만 commit되므로 취소·실패 요청이 오염시키지 못한다
  (구버전 상태는 0으로 마이그레이션하며, 그룹을 못 찾는 요청은 bank miss 백오프가 담당하므로 제외).
- 토큰 추정: ASCII/4 + 비ASCII/2 + 메시지당 framing 4토큰. 1024토큰 미만 프리픽스는 마킹 생략.
  (후속: 응답 usage.inputTokens 기반 런타임 보정)
- 캐시 storage 접근 실패(키 suffix·뱅크 로드)는 조용히 생략하지 않고 요청 전송 전에 `LGP:ERR:102`로
  사용자에게 표면화한다. 순수 계획 단계 예외(플러그인 버그)는 채팅 요청을 죽이지 않고 로그 후 캐시 없이
  진행한다 — disabled 모드도 같은 경로를 타 수정 배포 전 우회가 없기 때문. 손상된 index·slot은 빈 뱅크로 자가 회복.

## 캐시 손익 원장 (`src/ledger/`)

- 토큰 등가 순절감은 `0.9 × readTokens − 0.25 × writeTokens`로 표시한다.
- 실측 USD 절감은 일반 입력 토큰의 `input_cost` 단가를 역산한 뒤 캐시 읽기 절감에서 캐시 쓰기 프리미엄을 뺀다.
- `cost_details`가 없거나 일반 입력 토큰이 0이면 해당 응답의 `savedUsd`만 누적하지 않고 읽기/쓰기 토큰은 유지한다.
  `input_cost`/`cached_input_cost`/`cache_write_input_cost` 개별 부재는 0으로 취급한다.
- 구버전 원장의 `costUsd`, `savedUsd`, `lastCostSample`은 Zod 기본값으로 제자리 마이그레이션한다.

## 런타임 환경 / 제약

- **iframe 샌드박스**: CSP `connect-src 'none'` — 네트워크는 RisuAI 브릿지 경유만 가능.
  `AbortSignal`은 ABORT_SIGNAL_REF로 통과한다.
- **server-side 단일 경로 (bridge-fetch.ts)**: LLM Gateway는 browser direct 호출을 지원하지 않고,
  최신 `nativeFetch`에는 외부 URL의 proxy 강제 옵션이 없다. 모든 요청을 legacy
  `risuFetch(rawResponse:true, plainFetchDeforce:true)`로 보내 web/node에서는 `/proxy2`,
  Tauri에서는 native HTTP를 사용한다. RisuAI의 "직접 요청 보내기" 설정은 이 프로바이더에
  적용하지 않는다. 구형 Safari도 `ReadableStream` 대신 완성된 `Uint8Array`만 iframe으로
  전달받아 같은 경로로 동작하며 별도 transferable streams probe가 필요 없다.
  **실패 후 다른 경로 재시도는 중복 과금 위험이 있어 금지**한다. decoupled 모드는
  buffered-decoupled로 동작한다 (네트워크 연결은 스트리밍, 플러그인 소비는 완료 후 일괄).
  `globalFetch` 내부 실패의 문자열·빈 헤더·합성 400은 실제 HTTP 400으로 재구성하지 않고
  `BridgeFetchError`로 올려 사용자 문구에서 구분한다. 실제 응답은 성공 여부와 무관하게 `Uint8Array`다.
  headers의 content-type은 반드시 `Content-Type` 표기 하나로 정규화한다 — globalFetch가 대문자
  기본값을 별도 키로 추가해 중복되면 게이트웨이가 body를 빈 객체로 취급한다 (실측 HTTP 400 ZodError).
- **프로바이더 인자 실체**: `ProviderArguments`의 샘플러 값들은 d.ts와 달리 런타임에 누락될 수 있다
  (RisuAI `applyParameters`가 -1000 "off" 값을 skip). llm-io가 undefined를 omit하므로 그대로 통과시킨다.
- **temperature 스케일**: RisuAI가 이미 /100 해서 API 스케일(0~2)로 넘겨준다. 추가 변환 금지.
- **penalty 스케일**: frequency/presence penalty도 RisuAI가 이미 /100 해서 넘겨준다. `extraBody`에 그대로 전달한다.
- **max_tokens**: RisuAI 값을 Gateway 전용 extra body의 `max_tokens`로 전달한다. llm-io의
  `maxTokens`는 `max_completion_tokens`로 직렬화되어 Gateway ingress에서 제거되므로 사용하지 않는다.
  Hosted GPT-5.6는 2026-07-23 실측에서도 범위만 검증하고 출력 제한에는 반영하지 않았다.
- **reasoning/verbosity 경로**: RisuAI는 플러그인 provider 인자를 하드코딩해 두 값을 전달하지 않는다.
  플러그인 인자에서 읽어 llm-io `OpenAIChatCompletionsExtraBody`로 보내는 경로가 유일하다.
- **flags 등록 스냅샷**: flags는 플러그인 로드 때 읽어 provider model metadata에 고정한다.
  변경 적용에는 새로고침이 필요하다. `streaming_mode`는 매 요청 라이브로 읽어 저장 즉시
  반영된다 — hasStreaming flag 자동 선언이 사라져 등록 스냅샷과 무관해졌기 때문
  (provider/request-llm-gateway.ts 주석 참고).
- **LLMFlags 숫자 동기화**: `src/options/llm-flags.ts`의 이름→숫자 매핑은 RisuAI
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
  decoupled에서 text-delta가 0개면(reasoning-only 토큰 소진, 비SSE 200 본문 등) 무음 빈 성공 대신
  finishReason·이벤트 수 진단을 담은 실패를 반환한다 (`toEmptyStreamFailureContent`). 빈 응답 중
  이벤트가 1개 이상인 완료 응답은 과금·서버측 캐시 쓰기가 끝났으므로 앵커·원장을 커밋하지만
  (재시도가 캐시 read 이득을 봄), zero-event는 게이트웨이 완료 증거가 없어 커밋하지 않는다 —
  실패 프롬프트가 다음 diff 기준을 오염시키지 않는 기존 실패 계약을 따른다.
- **미디어 flags 미노출**: `convert.ts`가 텍스트와 이미지 입력만 변환하므로, Image Output·Audio·Video
  flags는 설정 UI의 flags 목록(`CONFIGURABLE_LLM_FLAG_NAMES`)에 두지 않는다. 멀티모달 변환 구현 전
  노출하면 데이터가 조용히 유실될 수 있다.

## 알려진 제한

- 캐시 원장과 앵커 상태는 read-modify-write가 비원자적이라 동시 요청 시 갱신이 유실될 수 있다.
  RisuAI의 `doingChat` 락으로 실사용 채팅 요청은 순차 실행되므로 별도 잠금은 두지 않는다.
- decoupled 소비 루프는 body chunk 사이에서 abort를 확인해 중단하고 앵커·원장을 저장하지 않는다.
  legacy 브릿지는 abort를 RisuAI 네트워크 계층까지 전달하지만 `/proxy2` 서버가 응답 헤더 전에
  upstream 요청을 중단하는지는 런타임 구현에 의존한다.
- RisuAI 본체의 provider 권한 확인은 반환값을 무시해 사용자가 권한을 거부해도 호출을 차단하지 않는다.
- RisuAI 본체의 `customV3ProviderMetaStore`는 재활성화 때 이전 메타를 제거하지 않고 누적한다.
  옛 flags가 계속 사용될 수 있으므로 설정 변경 적용은 플러그인 재활성화가 아니라 새로고침을 사용한다.

## Git

- 커밋 시 `/commit-with-context`를 사용하여 의사결정 컨텍스트를 보존한다.
