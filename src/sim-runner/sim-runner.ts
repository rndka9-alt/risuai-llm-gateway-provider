import type { LlmMessage } from 'llm-io';
import { z } from 'zod';
import { simulate, type CacheCostModel, type ReplayResult, type SimulationScenario } from '../sim';
import { resolveStandalonePolicyFactory, STANDALONE_POLICY_NAMES } from './policies';

const standaloneMessageSchema = z
  .object({
    content: z.string(),
    repeat: z.number().int().positive().max(10_000).optional(),
    role: z.enum(['system', 'user', 'assistant']),
  })
  .strict();

const standaloneScenarioSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    requests: z
      .array(
        z
          .object({
            elapsedMinutes: z.number().finite().nonnegative(),
            messages: z.array(standaloneMessageSchema).min(1),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

function valuesAreUnique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

export const standaloneSimulationInputSchema = z
  .object({
    cacheBackendPresets: z
      .array(z.enum(['calibrated', 'pessimistic', 'optimistic']))
      .min(1)
      .refine(valuesAreUnique, 'cacheBackendPresets must not contain duplicates.'),
    costModel: z
      .object({
        readTokenSavingsRate: z.number().finite().nonnegative(),
        writeTokenPremiumRate: z.number().finite().nonnegative(),
      })
      .strict(),
    policies: z
      .array(z.enum(STANDALONE_POLICY_NAMES))
      .min(1)
      .refine(valuesAreUnique, 'policies must not contain duplicates.'),
    scenarios: z.array(standaloneScenarioSchema).min(1),
    schemaVersion: z.literal(1),
  })
  .strict()
  .refine(
    (input) => valuesAreUnique(input.scenarios.map((scenario) => scenario.id)),
    'scenario ids must be unique.',
  );

export type StandaloneSimulationInput = z.infer<typeof standaloneSimulationInputSchema>;

export interface StandaloneReplayRequestLog {
  anchorIndexes: readonly number[];
  atMinute: number;
  elapsedMinutes: number;
  inputTokens: number;
  markerPrefixTokens: readonly number[];
  netSavedTokens: number;
  policyMarkerCount: number;
  readTokens: number;
  requestIndex: number;
  wireMarkerCount: number;
  writeTokens: number;
}

export interface StandaloneReplayResult {
  cacheHitSimulatorName: string;
  policyName: string;
  requests: readonly StandaloneReplayRequestLog[];
  scenarioId: string;
  scenarioLabel: string;
  totalInputTokens: number;
  totalNetSavedTokens: number;
  totalReadTokens: number;
  totalWriteTokens: number;
}

export interface StandaloneSimulationReport {
  costModel: CacheCostModel;
  results: readonly StandaloneReplayResult[];
  schemaVersion: 1;
}

function toLlmMessage(
  message: StandaloneSimulationInput['scenarios'][number]['requests'][number]['messages'][number],
): LlmMessage {
  return {
    content: [{ text: message.content.repeat(message.repeat ?? 1), type: 'text' }],
    role: message.role,
  };
}

function toSimulationScenario(
  scenario: StandaloneSimulationInput['scenarios'][number],
): SimulationScenario {
  return {
    id: scenario.id,
    label: scenario.label,
    requests: scenario.requests.map((request) => ({
      elapsedMinutes: request.elapsedMinutes,
      messages: request.messages.map(toLlmMessage),
    })),
  };
}

function installEmptyPluginStorage(): void {
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, 'risuai', {
    configurable: true,
    value: {
      pluginStorage: {
        getItem: async (key: string) => storage.get(key) ?? null,
        setItem: async (key: string, value: string) => {
          storage.set(key, value);
        },
      },
    },
    writable: true,
  });
}

function restoreRisuaiProperty(previousDescriptor: PropertyDescriptor | undefined): void {
  if (previousDescriptor === undefined) {
    if (!Reflect.deleteProperty(globalThis, 'risuai')) {
      throw new Error('Failed to restore the global risuai property.');
    }
    return;
  }
  Object.defineProperty(globalThis, 'risuai', previousDescriptor);
}

function toStandaloneReplayResult(result: ReplayResult): StandaloneReplayResult {
  return {
    cacheHitSimulatorName: result.cacheHitSimulatorName,
    policyName: result.policyName,
    requests: result.logs.map((log) => ({
      anchorIndexes: log.anchorIndexes,
      atMinute: log.atMinute,
      elapsedMinutes: log.elapsedMinutes,
      inputTokens: log.inputTokens,
      markerPrefixTokens: log.markerPrefixTokens,
      netSavedTokens: log.netSavedTokens,
      policyMarkerCount: log.policyMarkerCount,
      readTokens: log.readTokens,
      requestIndex: log.requestIndex,
      wireMarkerCount: log.wireMarkerCount,
      writeTokens: log.writeTokens,
    })),
    scenarioId: result.scenarioId,
    scenarioLabel: result.scenarioLabel,
    totalInputTokens: result.totalInputTokens,
    totalNetSavedTokens: result.totalNetSavedTokens,
    totalReadTokens: result.totalReadTokens,
    totalWriteTokens: result.totalWriteTokens,
  };
}

export async function runStandaloneSimulation(
  rawInput: unknown,
): Promise<StandaloneSimulationReport> {
  const input = standaloneSimulationInputSchema.parse(rawInput);
  const previousRisuaiDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'risuai');

  try {
    const report = await simulate({
      cacheHitSimulatorPresets: input.cacheBackendPresets,
      costModel: input.costModel satisfies CacheCostModel,
      policyFactories: input.policies.map(resolveStandalonePolicyFactory),
      prepareReplay: installEmptyPluginStorage,
      scenarios: input.scenarios.map(toSimulationScenario),
    });
    return {
      costModel: report.costModel,
      results: report.results.map(toStandaloneReplayResult),
      schemaVersion: 1,
    };
  } finally {
    restoreRisuaiProperty(previousRisuaiDescriptor);
  }
}
