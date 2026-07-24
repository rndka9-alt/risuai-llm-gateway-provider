import type { JsonObject, LlmMessage } from 'llm-io';
import type { SimulationScenario } from '../scenarios';
import { OpenAIChatCompletionsFormat } from 'llm-io';
import { CACHE_READ_SAVING_RATE, CACHE_WRITE_PREMIUM_RATE } from '../../../ledger';
import type { FakeGatewayAccounting } from '../gateway/fake-gateway';
import { FakeGatewayKernel } from '../gateway/fake-gateway';
import type { ReplayCachePolicy } from '../strategies/cache-policies';

export interface ReplayRequestLog extends FakeGatewayAccounting {
  anchorIndexes: readonly number[];
  atMinute: number;
  consecutiveEpochResets: number;
  elapsedMinutes: number;
  netSavedTokens: number;
  policyMarkerCount: number;
  policyMarkerRoles: readonly string[];
  promptCacheKey: string;
  requestBody: JsonObject;
  requestIndex: number;
}

export interface ReplayResult {
  kernelName: string;
  logs: readonly ReplayRequestLog[];
  policyName: string;
  totalInputTokens: number;
  totalNetSavedTokens: number;
  totalReadTokens: number;
  totalWriteTokens: number;
  scenarioId: string;
  scenarioLabel: string;
}

function countPolicyMarkers(messages: readonly LlmMessage[]): {
  count: number;
  roles: readonly string[];
} {
  let count = 0;
  const roles: string[] = [];
  messages.forEach((message) => {
    message.content.forEach((part) => {
      if (part.type === 'text' && part.cacheBreakpoint !== undefined) {
        count += 1;
        roles.push(message.role);
      }
    });
  });
  return { count, roles };
}

function calculateRequestNetSavedTokens(readTokens: number, writeTokens: number): number {
  return readTokens * CACHE_READ_SAVING_RATE - writeTokens * CACHE_WRITE_PREMIUM_RATE;
}

export async function replayScenario(options: {
  kernel: FakeGatewayKernel;
  policy: ReplayCachePolicy;
  scenario: SimulationScenario;
}): Promise<ReplayResult> {
  const { kernel, policy, scenario } = options;
  const logs: ReplayRequestLog[] = [];
  let atMinute = 0;

  for (let requestIndex = 0; requestIndex < scenario.requests.length; requestIndex += 1) {
    const request = scenario.requests[requestIndex];
    if (!Number.isFinite(request.elapsedMinutes) || request.elapsedMinutes < 0) {
      throw new RangeError(
        `Scenario ${scenario.id} request ${requestIndex} has invalid elapsedMinutes.`,
      );
    }
    atMinute += request.elapsedMinutes;
    const decision = await policy.apply(request.messages, { atMinute });
    const markerObservation = countPolicyMarkers(decision.messages);
    const format = new OpenAIChatCompletionsFormat({
      model: 'offline-simulation-model',
      extraBody: {
        prompt_cache_key: decision.promptCacheKey,
        prompt_cache_options: { mode: 'explicit', ttl: '30m' },
      },
    });
    const requestBody = format.createRequestBody({ messages: decision.messages });
    const accounting = kernel.process({
      atMinute,
      promptCacheKey: decision.promptCacheKey,
      requestBody,
    });
    logs.push({
      ...accounting,
      anchorIndexes: decision.anchorIndexes,
      atMinute,
      consecutiveEpochResets: decision.consecutiveEpochResets,
      elapsedMinutes: request.elapsedMinutes,
      netSavedTokens: calculateRequestNetSavedTokens(accounting.readTokens, accounting.writeTokens),
      policyMarkerCount: markerObservation.count,
      policyMarkerRoles: markerObservation.roles,
      promptCacheKey: decision.promptCacheKey,
      requestBody,
      requestIndex,
    });
  }

  return {
    kernelName: kernel.name,
    logs,
    policyName: policy.name,
    totalInputTokens: logs.reduce((total, log) => total + log.inputTokens, 0),
    totalNetSavedTokens: logs.reduce((total, log) => total + log.netSavedTokens, 0),
    totalReadTokens: logs.reduce((total, log) => total + log.readTokens, 0),
    totalWriteTokens: logs.reduce((total, log) => total + log.writeTokens, 0),
    scenarioId: scenario.id,
    scenarioLabel: scenario.label,
  };
}
