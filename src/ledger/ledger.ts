import type { LlmUsage } from 'llm-io';
import { calculateSavedUsd } from './savings';
import {
  createEmptyCacheLedger,
  rawServiceTierSchema,
  usageCostDetailsSchema,
  usageCostSchema,
  type LastCostSample,
} from './schema';
import { loadCacheLedger, saveCacheLedger } from './storage';

function createLastCostSample(
  usage: LlmUsage | undefined,
  rawResponse: unknown,
  model: string,
  requestedServiceTier: string | undefined,
): LastCostSample {
  const usageCostResult = usageCostSchema.safeParse(usage?.details);
  const usageCostDetailsResult = usageCostDetailsSchema.safeParse(usage?.details);
  const rawServiceTierResult = rawServiceTierSchema.safeParse(rawResponse);

  return {
    cost: usageCostResult.success ? usageCostResult.data.cost : undefined,
    costDetails: usageCostDetailsResult.success
      ? usageCostDetailsResult.data.costDetails
      : undefined,
    serviceTier: rawServiceTierResult.success
      ? (rawServiceTierResult.data.service_tier ?? undefined)
      : undefined,
    ...(requestedServiceTier === undefined ? {} : { requestedServiceTier }),
    model,
    at: new Date().toISOString(),
  };
}

export async function accumulateCacheUsage(
  usage: LlmUsage | undefined,
  rawResponse: unknown,
  model: string,
  requestedServiceTier?: string,
): Promise<void> {
  // usage 부재·캐시 필드 부재 = 이 응답엔 캐시 활동이 없었다는 뜻이라 0으로 취급한다.
  const readTokens = usage?.cacheReadInputTokens ?? 0;
  const writeTokens = usage?.cacheCreationInputTokens ?? 0;
  const usageCostResult = usageCostSchema.safeParse(usage?.details);
  const cost = usageCostResult.success ? usageCostResult.data.cost : undefined;
  const savedUsd = calculateSavedUsd(usage);

  const ledger = await loadCacheLedger();
  ledger.readTokens += readTokens;
  ledger.writeTokens += writeTokens;
  if (cost !== undefined) ledger.costUsd += cost;
  if (savedUsd !== undefined) ledger.savedUsd += savedUsd;
  ledger.lastCostSample = createLastCostSample(usage, rawResponse, model, requestedServiceTier);
  await saveCacheLedger(ledger);
}

export async function resetCacheLedger(): Promise<void> {
  await saveCacheLedger(createEmptyCacheLedger());
}
