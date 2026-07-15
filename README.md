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
| `model` | 모델 ID (예: `gpt-5.6-sol`) — 설정 UI에서 sol/terra/luna 선택 가능 |
| `base_url` | (선택) 셀프호스팅 endpoint. 비우면 `https://api.llmgateway.io/v1` |

3. 모델 선택에서 `LLM Gateway`를 선택한다.

## 지원 범위

- OpenAI Chat Completions 형식 (`/v1/chat/completions`) 단일 경로
- GPT-5.6 시리즈 대응: `max_completion_tokens` 사용
- 전달 파라미터: `max_tokens`(→ `max_completion_tokens`), `temperature`, `top_p`
- 논스트리밍 응답만 지원 (스트리밍은 추후)

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
