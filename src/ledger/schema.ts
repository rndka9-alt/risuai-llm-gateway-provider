import type { JsonObject, JsonValue } from 'llm-io';
import { z } from 'zod';

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

const jsonObjectSchema: z.ZodType<JsonObject> = z.record(z.string(), jsonValueSchema);

const lastCostSampleSchema = z.object({
  cost: z.number().optional(),
  costDetails: jsonObjectSchema.optional(),
  serviceTier: z.string().optional(),
  requestedServiceTier: z.string().optional(),
  model: z.string(),
  // 관측 시각 하나의 형식 오류로 누적 원장 전체를 0으로 되돌리는 것은 실익보다 손실이 크다.
  at: z.string(),
});

export const cacheLedgerSchema = z.object({
  readTokens: z.number(),
  since: z.string(),
  writeTokens: z.number(),
  // 구버전 원장은 비용 필드가 없으므로 기본값으로 제자리 마이그레이션한다.
  costUsd: z.number().default(0),
  savedUsd: z.number().default(0),
  lastCostSample: lastCostSampleSchema.nullable().default(null),
});

export const usageCostSchema = z.object({ cost: lastCostSampleSchema.shape.cost });
export const usageCostDetailsSchema = z.object({
  costDetails: lastCostSampleSchema.shape.costDetails,
});
export const rawServiceTierSchema = z.object({
  service_tier: lastCostSampleSchema.shape.serviceTier.nullable(),
});
export const cacheSavingsUsageSchema = z.object({
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
