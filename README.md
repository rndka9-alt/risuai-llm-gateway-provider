# risuai-llm-gateway-provider

[LLM Gateway](https://llmgateway.io)를 RisuAI의 커스텀 프로바이더로 추가하는 플러그인.
요청/응답 처리는 [llm-io](https://github.com/rndka9-alt/llm-io)의 `LLMGatewayProvider` + `OpenAIChatCompletionsFormat`을 사용한다.

## 설치

1. `plugin.min.js`를 RisuAI 설정 → 플러그인에서 추가한다.
2. 플러그인 인자를 입력한다.

| 인자 | 설명 |
| --- | --- |
| `api_key` | LLM Gateway API 키 (`llmgtwy_...`) |
| `prompt_cache_mode` | 프롬프트 캐시 모드 (`explicit` 또는 `disabled`, 기본값 `disabled`) |
| `service_tier` | (선택) 서비스 티어 (`default` 또는 `flex`). 비우면 provider 기본(auto) |
| `reasoning_effort` | (선택) 추론 강도 (`none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`). 비우면 body에서 생략 |
| `verbosity` | (선택) 응답 자세함 (`low`, `medium`, `high`). 비우면 body에서 생략 |
| `streaming_mode` | 스트리밍 모드 (`off`, `decoupled`, `stream`, 기본값 `off`) |
| `flags` | LLM flag 이름의 콤마 구분 목록: `hasFullSystemPrompt`, `hasFirstSystemPrompt`, `requiresAlternateRole`, `mustStartWithUserInput`, `poolSupported`. 기본값 `hasFullSystemPrompt` |
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
  - `stream`: text delta를 RisuAI `ReadableStream<string>`으로 전달
- RisuAI 모델 메타에 선택한 flags와 sampler slider 목록을 등록하며, 스트리밍 모드에서는 `hasStreaming`을 자동 포함
- 미디어 flags는 텍스트 전용 변환에서 데이터가 유실될 수 있어 설정 UI에서 비활성화
- `flags` 또는 `streaming_mode` 변경은 플러그인 재등록이 필요하므로 저장 후 새로고침 또는 플러그인 재활성화

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
