import type { LlmFinishReason, LlmUsage } from 'llm-io';
import type { GatewayRequestContext, StreamConsumptionResult } from './types';

export async function consumeGatewayStream(
  context: GatewayRequestContext,
): Promise<StreamConsumptionResult> {
  const stream = context.gatewayClient.stream({
    messages: context.messages,
    options: context.requestOptions,
    signal: context.abortSignal,
  });
  const reader = stream.getReader();
  let text = '';
  let usage: LlmUsage | undefined;
  let finishReason: LlmFinishReason | undefined;
  let reasoningDeltaCount = 0;
  let streamEventCount = 0;

  try {
    while (true) {
      context.abortSignal?.throwIfAborted();
      const result = await reader.read();
      context.abortSignal?.throwIfAborted();
      if (result.done) break;

      const event = result.value;
      // 'done'은 파서가 스트림 종료 시 항상 합성하므로, 와이어에서 실제로 chunk를
      // 받았는지 판별하는 카운트에서는 제외한다.
      if (event.type !== 'done') {
        streamEventCount += 1;
      }
      if (event.type === 'text-delta') {
        text += event.text;
      } else if (event.type === 'reasoning-delta') {
        reasoningDeltaCount += 1;
      } else if (event.type === 'finish') {
        finishReason = event.finishReason;
      } else if (event.type === 'usage') {
        usage = event.usage;
      } else if (event.type === 'done') {
        if (event.usage !== undefined) {
          usage = event.usage;
        }
        if (event.finishReason !== undefined) {
          finishReason = event.finishReason;
        }
      }
    }
  } finally {
    try {
      if (context.abortSignal?.aborted === true) {
        await reader.cancel(context.abortSignal.reason);
      }
    } finally {
      reader.releaseLock();
    }
  }

  return { finishReason, reasoningDeltaCount, streamEventCount, text, usage };
}
