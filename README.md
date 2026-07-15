# risuai-llm-gateway-provider

[LLM Gateway](https://llmgateway.io)를 RisuAI의 커스텀 프로바이더로 추가하는 플러그인.
요청/응답 처리는 [llm-io](https://github.com/rndka9-alt/llm-io)의 `LLMGatewayProvider` + `OpenAIChatCompletionsFormat`을 사용한다.

## 설치

1. `plugin.min.js`를 RisuAI 설정 → 플러그인에서 추가한다.
2. 플러그인 인자를 입력한다.

| 인자 | 설명 |
| --- | --- |
| `api_key` | LLM Gateway API 키 (`llmgtwy_...`) |
| `prompt_cache_mode` | 프롬프트 캐시 모드 (`explicit` 또는 `disabled`, 기본값 `explicit`) |
| `service_tier` | (선택) 서비스 티어 (`default` 또는 `flex`). 비우면 provider 기본(auto) |
| `reasoning_effort` | (선택) 추론 강도 (`none`, `low`, `medium`, `high`, `xhigh`, `max`). 비우면 body에서 생략 |
| `verbosity` | (선택) 응답 자세함 (`low`, `medium`, `high`). 비우면 body에서 생략 |
| `streaming_mode` | 스트리밍 모드 (`off`, `decoupled`, 기본값 `off`) |
| `flags` | LLM flag 이름의 콤마 구분 목록: `hasFullSystemPrompt`, `hasFirstSystemPrompt`, `requiresAlternateRole`, `mustStartWithUserInput`, `poolSupported`. 기본값 `hasFullSystemPrompt`, 모두 해제하면 `none` |
| `model` | 모델 ID (예: `gpt-5.6-sol`) — 설정 UI에서 sol/terra/luna 선택 가능 |
| `base_url` | (선택) 셀프호스팅 endpoint. 비우면 `https://api.llmgateway.io/v1` |

3. 모델 선택에서 `LLM Gateway`를 선택한다.

## 지원 범위

- OpenAI Chat Completions 형식 (`/v1/chat/completions`) 단일 경로
- GPT-5.6 시리즈 대응: `max_completion_tokens` 사용
- 전달 파라미터: `max_tokens`(→ `max_completion_tokens`), `temperature`, `top_p`, `frequency_penalty`, `presence_penalty`, 선택한 `reasoning_effort`, `verbosity`
- 스트리밍 모드:
  - `off`: JSON 응답을 한 번에 반환
  - `decoupled`: upstream은 스트리밍으로 소비하고 RisuAI에는 완성 문자열 반환
- RisuAI 모델 메타에 선택한 flags, sampler slider 목록, o200k tokenizer를 등록
- 미디어 flags는 텍스트 전용 변환에서 데이터가 유실될 수 있어 설정 UI에서 비활성화
- `flags` 또는 `streaming_mode` 변경은 플러그인 재등록이 필요하므로 저장 후 새로고침

## 프롬프트 캐시 관측

- 설정 UI의 캐시 손익 원장은 읽기/쓰기 토큰, 실 지출, `usage.details.costDetails`에서 역산한 실측 USD 절감액을 누적한다. 비용 상세가 없는 응답은 토큰만 누적한다.
- explicit 모드는 직전 요청과의 프리픽스 diff로 breakpoint를 관리한다.
- 프롬프트 앞부분이 3회 연속 완전히 바뀌면 쓰기 프리미엄 손실을 막기 위해 마킹을 자동 중단한다. 안정 프리픽스가 다시 확인되면 자동 재개한다.
- 백오프 발동과 해제는 메인 화면 토스트로 알리고, 활성 상태와 점검할 프리셋 항목은 설정 UI에 표시한다.

## 빌드

```bash
npm install
npm run build      # esbuild(TS→JS 번들) + terser(minify) → plugin.min.js
npm run typecheck  # 타입 체크만
npm test           # vitest
```

## 릴리즈

```bash
./release.sh              # patch
./release.sh minor        # minor
./release.sh patch "노트"  # 릴리즈 노트 지정
```
