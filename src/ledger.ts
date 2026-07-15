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
  requestedServiceTier: z.string().optional(),
  model: z.string(),
  // 관측 시각 하나의 형식 오류로 누적 원장 전체를 0으로 되돌리는 것은 실익보다 손실이 크다.
  at: z.string(),
});

const cacheLedgerSchema = z.object({
  readTokens: z.number(),
  since: z.string(),
  writeTokens: z.number(),
  // 구버전 원장은 비용 필드가 없으므로 기본값으로 제자리 마이그레이션한다.
  costUsd: z.number().default(0),
  savedUsd: z.number().default(0),
  lastCostSample: lastCostSampleSchema.nullable().default(null),
});

const usageCostSchema = z.object({ cost: lastCostSampleSchema.shape.cost });
const usageCostDetailsSchema = z.object({
  costDetails: lastCostSampleSchema.shape.costDetails,
});
const rawServiceTierSchema = z.object({
  service_tier: lastCostSampleSchema.shape.serviceTier.nullable(),
});
const cacheSavingsUsageSchema = z.object({
  cacheCreationInputTokens: z.number().nonnegative().optional(),
  cacheReadInputTokens: z.number().nonnegative().optional(),
  details: z.object({
    costDetails: z.object({
      cached_input_cost: z.number().finite().optional(),
      cache_write_input_cost: z.number().finite().optional(),
      input_cost: z.number().finite().optional(),
    }),
  }),
  inputTokens: z.number().nonnegative(),
});

export type CacheLedger = z.infer<typeof cacheLedgerSchema>;
export type LastCostSample = z.infer<typeof lastCostSampleSchema>;

export function createEmptyCacheLedger(): CacheLedger {
  return {
    readTokens: 0,
    since: new Date().toISOString(),
    writeTokens: 0,
    costUsd: 0,
    savedUsd: 0,
    lastCostSample: null,
  };
}

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
  const readSavings =
    readTokens * unitPrice - cachedInputCost;
  const writePremium =
    cacheWriteInputCost - writeTokens * unitPrice;
  return readSavings - writePremium;
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
