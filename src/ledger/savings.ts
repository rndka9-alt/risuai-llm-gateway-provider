import type { LlmUsage } from 'llm-io';
import { CACHE_READ_SAVING_RATE, CACHE_WRITE_PREMIUM_RATE } from './constants';
import { cacheSavingsUsageSchema, type CacheLedger } from './schema';

// 입력 정가 토큰 등가 기준 순절감. 양수면 캐시가 이득이다.
export function calculateNetSavedTokens(ledger: CacheLedger): number {
  return Math.round(
    ledger.readTokens * CACHE_READ_SAVING_RATE - ledger.writeTokens * CACHE_WRITE_PREMIUM_RATE,
  );
}

export function calculateSavedUsd(usage: LlmUsage | undefined): number | undefined {
  const result = cacheSavingsUsageSchema.safeParse(usage);
  // 스트리밍 등에서 costDetails가 빠지면 실제 단가와 캐시 비용을 알 수 없다.
  // 추정값으로 원장을 오염시키지 않고 이 응답의 USD 절감 누적만 건너뛴다.
  if (!result.success) return undefined;

  const readTokens = result.data.cacheReadInputTokens ?? 0;
  const writeTokens = result.data.cacheCreationInputTokens ?? 0;
  const regularInputTokens = result.data.inputTokens - readTokens - writeTokens;
  // 일반 입력 토큰이 없으면 input_cost에서 단가를 역산할 수 없다. 토큰 원장은
  // 별도로 누적되므로 USD 절감만 건너뛰어 0 나눗셈과 잘못된 값을 막는다.
  if (regularInputTokens <= 0) return undefined;

  // llmgateway는 활동이 없는 비용 필드를 생략하므로 각 부재 값은 0으로 계산한다.
  const inputCost = result.data.details.costDetails.input_cost ?? 0;
  const cachedInputCost = result.data.details.costDetails.cached_input_cost ?? 0;
  const cacheWriteInputCost = result.data.details.costDetails.cache_write_input_cost ?? 0;
  const unitPrice = inputCost / regularInputTokens;
  const readSavings = readTokens * unitPrice - cachedInputCost;
  const writePremium = cacheWriteInputCost - writeTokens * unitPrice;
  return readSavings - writePremium;
}
