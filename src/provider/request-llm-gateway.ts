import {
  Llm,
  LLMGatewayProvider,
  OpenAIChatCompletionsFormat,
  type LlmRequestOptions,
} from 'llm-io';
import { createBridgeFetch } from '../bridge-fetch';
import { preparePromptCacheRequest, resolvePromptCacheMode } from '../cache';
import {
  API_KEY_ARGUMENT,
  EXTRA_BODY_ARGUMENT,
  MODEL_ARGUMENT,
  PROMPT_CACHE_MODE_ARGUMENT,
  REASONING_EFFORT_ARGUMENT,
  SERVICE_TIER_ARGUMENT,
  STREAMING_MODE_ARGUMENT,
  VERBOSITY_ARGUMENT,
  loadConfig,
} from '../config';
import { toLlmMessages } from '../convert';
import { applyCustomExtraBody } from '../extra-body';
import {
  toCacheStorageFailureContent,
  toEmptyStreamFailureContent,
  toFailureContent,
  toMissingApiKeyFailureContent,
} from '../failure-content';
import {
  DEFAULT_MODEL,
  resolveReasoningEffort,
  resolveServiceTier,
  resolveStreamingMode,
  resolveVerbosity,
} from '../options';
import { completeSuccessfulRequest } from './complete-successful-request';
import { consumeGatewayStream } from './consume-gateway-stream';
import type {
  GatewayChatCompletionsExtraBody,
  GatewayClient,
  GatewayRequestContext,
} from './types';

export async function requestLLMGateway(
  providerArguments: ProviderArguments,
  abortSignal?: AbortSignal,
): Promise<ProviderResponse> {
  const config = await loadConfig();
  // hasStreaming flag 자동 선언이 사라져 등록 스냅샷과 무관해졌으므로,
  // 스트리밍 모드는 매 요청 라이브로 읽어 저장 즉시 반영한다 (새로고침 불필요).
  const streamingMode = resolveStreamingMode(config[STREAMING_MODE_ARGUMENT]);
  const apiKey = config[API_KEY_ARGUMENT].trim();

  if (apiKey === '') {
    return {
      success: false,
      content: toMissingApiKeyFailureContent(),
    };
  }

  // 설정 UI는 모델 기본값을 표시만 하고 사용자가 바꾸기 전엔 저장하지 않으므로
  // (change 시점 즉시 저장), 미설정이면 표시값과 같은 기본 모델을 사용한다.
  const storedModel = config[MODEL_ARGUMENT].trim();
  const model = storedModel === '' ? DEFAULT_MODEL : storedModel;

  const promptCacheMode = resolvePromptCacheMode(config[PROMPT_CACHE_MODE_ARGUMENT]);
  const serviceTier = resolveServiceTier(config[SERVICE_TIER_ARGUMENT]);
  const reasoningEffort = resolveReasoningEffort(config[REASONING_EFFORT_ARGUMENT]);
  const verbosity = resolveVerbosity(config[VERBOSITY_ARGUMENT]);
  // 메시지 변환·커스텀 body 병합 예외(미지원 미디어, 초심층 JSON 등)도 promise reject가
  // 아니라 provider 실패 응답({success:false})으로 수렴해야 RisuAI가 처리할 수 있다
  try {
    const messages = toLlmMessages(providerArguments.prompt_chat);
    const cacheRequest = await preparePromptCacheRequest(messages, promptCacheMode);
    if (cacheRequest.status === 'storage-failure') {
      // 요청 전송 전의 환경성 실패 — 조용한 캐시 생략 대신 사용자에게 알린다.
      return { success: false, content: toCacheStorageFailureContent(cacheRequest.error) };
    }

    const extraBody: GatewayChatCompletionsExtraBody = {
      max_tokens: providerArguments.max_tokens,
      ...cacheRequest.cacheExtraBody,
      // 생략 시 조직 대시보드 기본 티어가 끼어들 수 있어 항상 명시한다 (resolveServiceTier 참고).
      service_tier: serviceTier,
      // RisuAI 본체는 custom provider 인자를 고정 목록으로 만들어 이 두 값을 전달하지 않는다.
      // 따라서 플러그인 인자가 Chat Completions body로 보낼 수 있는 유일한 경로다.
      ...(reasoningEffort === undefined ? {} : { reasoning_effort: reasoningEffort }),
      ...(verbosity === undefined ? {} : { verbosity }),
      // RisuAI가 이미 /100 스케일링한 값이므로 변환 없이 전달한다.
      ...(providerArguments.frequency_penalty === undefined
        ? {}
        : { frequency_penalty: providerArguments.frequency_penalty }),
      ...(providerArguments.presence_penalty === undefined
        ? {}
        : { presence_penalty: providerArguments.presence_penalty }),
      ...(streamingMode === 'off' ? {} : { stream_options: { include_usage: true } }),
    };
    // 설정 편집기의 커스텀 body(JSON)를 요청 직전에 deep merge한다 — 겹치는 필드는 커스텀이
    // 우선하고, invalid JSON이면 이번 요청에서는 통째로 무시된다 (extra-body.ts 계약)
    const requestExtraBody = applyCustomExtraBody(extraBody, config[EXTRA_BODY_ARGUMENT]);
    const gatewayClient: GatewayClient = new Llm({
      format: new OpenAIChatCompletionsFormat({ model, extraBody: requestExtraBody }),
      // 엔드포인트는 llm-io 기본값(공식 llmgateway.io)으로 고정한다. 인자로 열어두면
      // 타 플러그인이 v2 setArg로 바꿔칠 수 있어 api_key가 임의 주소로 전송될 수 있다.
      provider: new LLMGatewayProvider({ apiKey }),
      // 플러그인 iframe은 CSP(connect-src 'none')로 직접 fetch가 막혀 있어
      // RisuAI의 server-side proxy-aware 브릿지를 경유한다. 구형 Safari도 raw bytes
      // 객체만 전달받으므로 ReadableStream transferable 지원 여부와 무관하게 동작한다.
      fetch: createBridgeFetch(),
    });
    const requestOptions: LlmRequestOptions = {
      temperature: providerArguments.temperature,
      topP: providerArguments.top_p,
    };
    const context: GatewayRequestContext = {
      abortSignal,
      gatewayClient,
      messages: cacheRequest.requestMessages,
      requestOptions,
    };

    if (streamingMode === 'decoupled') {
      // 연결은 streaming으로 유지해 중간 응답 제한을 피하되, RisuAI에는 완성 문자열만 반환한다.
      const result = await consumeGatewayStream(context);
      if (result.text === '') {
        // 이벤트가 하나라도 있으면 과금·서버측 캐시 쓰기가 끝난 완료 응답이라 커밋하지만,
        // zero-event는 게이트웨이 완료 증거가 없어 실패 프롬프트가 다음 diff 기준을
        // 오염시키지 않도록 기존 실패 계약(미커밋)을 따른다.
        if (result.streamEventCount > 0) {
          await completeSuccessfulRequest(
            cacheRequest.pendingCommit,
            result.usage,
            undefined,
            model,
            serviceTier,
          );
        }
        return {
          success: false,
          content: toEmptyStreamFailureContent({
            finishReason: result.finishReason,
            reasoningDeltaCount: result.reasoningDeltaCount,
            streamEventCount: result.streamEventCount,
            usage: result.usage,
          }),
        };
      }
      await completeSuccessfulRequest(
        cacheRequest.pendingCommit,
        result.usage,
        undefined,
        model,
        serviceTier,
      );
      return { success: true, content: result.text };
    }

    const output = await context.gatewayClient.generate({
      messages: context.messages,
      options: context.requestOptions,
      signal: context.abortSignal,
    });
    await completeSuccessfulRequest(
      cacheRequest.pendingCommit,
      output.usage,
      output.raw,
      model,
      serviceTier,
    );
    return { success: true, content: output.message.text };
  } catch (error) {
    return { success: false, content: toFailureContent(error) };
  }
}
