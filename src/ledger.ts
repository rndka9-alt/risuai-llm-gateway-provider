import type { JsonObject, JsonValue, LlmUsage } from 'llm-io';
import { z } from 'zod';

// pluginStorage는 전 플러그인 공용 네임스페이스라 접두사가 필수다.
export const CACHE_LEDGER_STORAGE_KEY = 'llm-gateway-provider:cache-ledger';

// 캐시 쓰기 = 입력 정가의 1.25배(순수 추가비용 0.25배), 읽기 = 정가의 10%
// (절감 0.9배) 전제. 손익 표시 공식이 바뀔 수 있으므로 계산 결과가 아닌
// 읽기/쓰기 원시 토큰을 누적한다.
export const CACHE_WRITE_PREMIUM_RATE = 0.25;
export const CACHE_READ_SAVING_RATE = 0.9;

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(jsonValueSchema),
  ]),
);

const jsonObjectSchema: z.ZodType<JsonObject> = z.record(jsonValueSchema);

const lastCostSampleSchema = z.object({
  cost: z.number().optional(),
  costDetails: jsonObjectSchema.optional(),
  serviceTier: z.string().optional(),
  model: z.string(),
  at: z.string().datetime(),
});

const cacheLedgerSchema = z.object({
  readTokens: z.number(),
  since: z.string(),
  writeTokens: z.number(),
  // 구버전 원장은 비용 필드가 없으므로 기본값으로 제자리 마이그레이션한다.
  costUsd: z.number().default(0),
  lastCostSample: lastCostSampleSchema.nullable().default(null),
});

const usageCostSchema = z.object({ cost: lastCostSampleSchema.shape.cost });
const usageCostDetailsSchema = z.object({
  costDetails: lastCostSampleSchema.shape.costDetails,
});
const rawServiceTierSchema = z.object({
  service_tier: lastCostSampleSchema.shape.serviceTier,
});

export type CacheLedger = z.infer<typeof cacheLedgerSchema>;
export type LastCostSample = z.infer<typeof lastCostSampleSchema>;

export function createEmptyCacheLedger(): CacheLedger {
  return {
    readTokens: 0,
    since: new Date().toISOString(),
    writeTokens: 0,
    costUsd: 0,
    lastCostSample: null,
  };
}

// 입력 정가 토큰 등가 기준 순절감. 양수면 캐시가 이득이다.
export function calculateNetSavedTokens(ledger: CacheLedger): number {
  return Math.round(
    ledger.readTokens * CACHE_READ_SAVING_RATE - ledger.writeTokens * CACHE_WRITE_PREMIUM_RATE,
  );
}

// 손상·부재 원장은 0에서 새로 시작하는 것이 안전한 기본값이다. 여기서 throw하면
// 저장이 영영 갱신되지 않아 집계가 계속 실패하므로, 빈 원장으로 자가 회복한다.
export async function loadCacheLedger(): Promise<CacheLedger> {
  const raw = await risuai.pluginStorage.getItem(CACHE_LEDGER_STORAGE_KEY);
  if (typeof raw !== 'string' || raw === '') return createEmptyCacheLedger();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.error('[llm-gateway-provider] corrupted cache ledger; starting from zero', error);
    return createEmptyCacheLedger();
  }
  const result = cacheLedgerSchema.safeParse(parsed);
  return result.success ? result.data : createEmptyCacheLedger();
}

async function saveCacheLedger(ledger: CacheLedger): Promise<void> {
  await risuai.pluginStorage.setItem(CACHE_LEDGER_STORAGE_KEY, JSON.stringify(ledger));
}

function createLastCostSample(
  usage: LlmUsage | undefined,
  rawResponse: unknown,
  model: string,
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
      ? rawServiceTierResult.data.service_tier
      : undefined,
    model,
    at: new Date().toISOString(),
  };
}

export async function accumulateCacheUsage(
  usage: LlmUsage | undefined,
  rawResponse: unknown,
  model: string,
): Promise<void> {
  // usage 부재·캐시 필드 부재 = 이 응답엔 캐시 활동이 없었다는 뜻이라 0으로 취급한다.
  const readTokens = usage?.cacheReadInputTokens ?? 0;
  const writeTokens = usage?.cacheCreationInputTokens ?? 0;
  const usageCostResult = usageCostSchema.safeParse(usage?.details);
  const cost = usageCostResult.success ? usageCostResult.data.cost : undefined;

  const ledger = await loadCacheLedger();
  ledger.readTokens += readTokens;
  ledger.writeTokens += writeTokens;
  if (cost !== undefined) ledger.costUsd += cost;
  ledger.lastCostSample = createLastCostSample(usage, rawResponse, model);
  await saveCacheLedger(ledger);
}

export async function resetCacheLedger(): Promise<void> {
  await saveCacheLedger(createEmptyCacheLedger());
}
