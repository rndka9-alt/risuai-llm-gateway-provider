# risuai-llm-gateway-provider

[LLM Gateway](https://llmgateway.io)를 RisuAI의 `LLM Gateway` 커스텀 프로바이더로 추가하는 Plugin API v3 플러그인이다.
요청과 응답 변환에는 [llm-io](https://github.com/rndka9-alt/llm-io)의 `LLMGatewayProvider`와 `OpenAIChatCompletionsFormat`을 사용한다.

## 설치와 설정

1. [최신 릴리즈](https://github.com/rndka9-alt/risuai-llm-gateway-provider/releases/latest)에서 `plugin.min.js`를 내려받는다.
2. RisuAI의 **설정 → 플러그인**에서 파일을 추가하고 플러그인을 활성화한다.
3. 플러그인이 등록한 **LLM Gateway** 설정 화면을 열어 API 키와 요청 옵션을 설정한다.
4. 모델 선택에서 **LLM Gateway**를 선택한다.

설정은 값을 변경할 때마다 자동으로 저장된다. LLM flags를 변경한 경우에만 RisuAI를 새로고침해야 한다.

| 설정             | 값과 동작                                                                                               | 기본값             |
| ---------------- | ------------------------------------------------------------------------------------------------------- | ------------------ |
| API 키           | LLM Gateway API 키 (`llmgtwy_...`)                                                                      | 필수               |
| 캐시 모드        | `명시적 캐시 사용` 또는 `캐시 끄기`                                                                     | 명시적 캐시 사용   |
| Reasoning effort | 지정 안 함, `none`, `low`, `medium`, `high`, `xhigh`, `max`                                             | 지정 안 함         |
| Verbosity        | 지정 안 함, `low`, `medium`, `high`                                                                     | 지정 안 함         |
| 응답 방식        | 일반 요청 또는 스트리밍 연결을 끝까지 소비한 뒤 완성 응답 표시                                          | 일반 요청          |
| 모델             | `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`                                                          | `gpt-5.6-sol`      |
| 서비스 티어      | Gateway 기본 또는 `flex`                                                                                | Gateway 기본       |
| LLM flags        | `Full System Prompt`, `First System Prompt`, `Alternate Role`, `Must Start With User`, `Pool Supported` | Full System Prompt |

`Gateway 기본`은 `service_tier`를 요청에서 생략하여 Gateway 또는 조직 설정을 따른다. `flex`를 켜면 `service_tier: "flex"`를 명시한다.

## 지원 범위

- 공식 LLM Gateway endpoint의 OpenAI Chat Completions 경로(`/v1/chat/completions`)
- 텍스트 입력, user 메시지의 이미지 입력, 텍스트 출력
- RisuAI 샘플러: `temperature`, `top_p`, `frequency_penalty`, `presence_penalty`
- RisuAI의 `max_tokens`를 Gateway의 `max_tokens`로 전달
- 플러그인 설정의 `reasoning_effort`, `verbosity`, `service_tier`
- `o200k` tokenizer 메타데이터
- RisuAI 요청 취소 신호 전달

Responses API, 커스텀 endpoint, 오디오·비디오 변환은 지원하지 않는다. API 키가 임의 주소로 전송되지 않도록 endpoint는 llm-io의 공식 LLM Gateway 주소로 고정되어 있다.

Hosted GPT-5.6는 `max_tokens` 범위를 검증하지만 실제 출력 제한에는 반영하지 않는 상태가
2026-07-23 실측에서도 확인되었다. 플러그인은 공식 필드명으로 전달하지만 Gateway가 수정되기 전까지
RisuAI의 최대 토큰 설정이 적용되지 않을 수 있다.

### 응답 방식

- **일반 요청**: 비스트리밍 JSON 응답을 한 번에 받는다.
- **스트리밍 연결 · 완료 후 표시**: upstream 스트림을 플러그인이 끝까지 소비해 조립한 뒤 RisuAI에 완성 문자열을 반환한다. RisuAI 화면에 토큰이 실시간으로 표시되는 방식은 아니다.

응답 방식은 요청할 때마다 현재 설정을 읽으므로 변경 후 새로고침하지 않아도 된다. 구버전의 `stream` 저장값은 `스트리밍 연결 · 완료 후 표시`로 자동 정규화된다.

## 프롬프트 캐시

명시적 캐시 모드는 요청에 30분 TTL과 고정 cache key를 넣고, 직전의 성공한 요청과 비교해 재사용 가능한 프리픽스에 breakpoint를 자동 배치한다.

- 메시지 단위 공통 프리픽스와 서픽스로 변경 구간을 찾는다.
- 최소 1,024토큰으로 추정되는 프리픽스만 마킹한다.
- 최대 4개의 캐시 앵커를 유지한다.
- assistant 메시지는 직렬화 과정에서 breakpoint가 유실되므로 가까운 system 또는 user 메시지로 마킹 지점을 옮긴다.
- 요청이 실패하거나 스트림이 중단되면 해당 요청을 다음 비교 기준으로 저장하지 않는다.
- 캐시 처리 자체가 실패하면 breakpoint 없이 요청을 계속한다.

프롬프트 앞부분이 3회 연속 완전히 바뀌면 불필요한 캐시 쓰기 비용을 막기 위해 breakpoint 마킹을 일시 중단한다. 안정된 프리픽스가 다시 확인되면 자동으로 재개하며, 발동과 해제는 토스트로 알린다. 중단 중에는 설정 화면에 `{{time}}`, `{{random}}`, 확률 로어북 등 매 요청마다 앞부분을 바꿀 수 있는 항목을 점검하라는 안내가 표시된다.

앵커 비교 상태에는 메시지 원문 대신 FNV-1a fingerprint와 토큰 추정치만 저장한다. `캐시 끄기` 상태에서도 비교 상태는 계속 갱신되므로 캐시를 다시 켰을 때 오래된 요청과 잘못 비교하지 않는다.

### 캐시 손익 표시

설정 화면 하단에서 누적 캐시 읽기·쓰기 토큰과 손익을 확인하고 초기화할 수 있다.

- 비용 상세가 있는 응답은 일반 입력 단가와 실제 캐시 비용으로 USD 절감액을 계산한다.
- 비용 상세가 없으면 `0.9 × 읽기 토큰 − 0.25 × 쓰기 토큰`의 정가 토큰 등가 손익을 표시한다.
- 스트리밍 응답처럼 비용 상세가 없는 경우에도 읽기·쓰기 토큰은 누적한다.

## 설정 저장과 업그레이드

현재 설정은 RisuAI의 `pluginStorage`에 하나의 config로 저장되며, 전용 설정 화면이 유일한 편집 경로다. 이전 버전에서 업데이트하면 최초 실행 시 기존 argument backup을 우선 이식하고, backup이 없으면 기존 플러그인 인자 중 비어 있지 않은 값을 이식한다. 이식이 끝난 뒤에는 기존 플러그인 인자를 다시 읽지 않는다.

LLM flags는 프로바이더 등록 시점에 고정되므로 변경 후 새로고침해야 한다. 다른 설정은 요청 시점에 읽혀 즉시 적용된다.

## 개발

```bash
npm install
npm run build      # TS/TSX + CSS 번들 및 minify → plugin.min.js
npm run typecheck  # TypeScript 타입 검사
npm test           # 기능·계약 테스트 (sim 제외)
npm run test:sim   # 캐싱 효율 측정 벤치마크 — 캐시 정책 변경 시에만
npm run test:all   # 둘 다
npm run test:watch
```

빌드 버전은 `package.json`에서만 관리하며, `plugin.min.js`의 `@version` 메타데이터에 자동 반영된다.

## 릴리즈

```bash
./release.sh                        # patch 버전, 릴리즈 노트 편집기 사용
./release.sh minor                  # minor 버전
./release.sh major "릴리즈 노트"    # major 버전과 릴리즈 노트 지정
```

릴리즈 스크립트는 버전 변경과 빌드 후 커밋·태그·push를 수행하고, `plugin.min.js`가 첨부된 GitHub Release를 생성한다.

## 라이선스

이 저장소의 고유 코드는 [CC0-1.0](LICENSE)으로 공개된다. 배포 산출물에 번들되는
서드파티 구성요소(Preact, Zod, Lucide 등)는 각자의 라이선스를 유지하며, 고지 전문은
[THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt)와 `plugin.min.js` 상단 배너에 수록된다.
