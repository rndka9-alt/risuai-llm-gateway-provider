import type {
  Llm,
  LlmFinishReason,
  LlmMessage,
  LlmRequestOptions,
  LlmUsage,
  OpenAIChatCompletionsExtraBody,
  OpenAIChatCompletionsRaw,
} from 'llm-io';

export type GatewayClient = Llm<OpenAIChatCompletionsRaw>;

/** llmgateway.io는 출력 제한을 max_tokens로 받지만 llm-io의 maxTokens는
 * max_completion_tokens로 직렬화하므로 Gateway 전용 필드를 extraBody로 전달한다. */
export interface GatewayChatCompletionsExtraBody extends OpenAIChatCompletionsExtraBody {
  max_tokens: number;
}

export interface GatewayRequestContext {
  abortSignal: AbortSignal | undefined;
  gatewayClient: GatewayClient;
  messages: readonly LlmMessage[];
  requestOptions: LlmRequestOptions;
}

export interface StreamConsumptionResult {
  finishReason: LlmFinishReason | undefined;
  reasoningDeltaCount: number;
  streamEventCount: number;
  text: string;
  usage: LlmUsage | undefined;
}
