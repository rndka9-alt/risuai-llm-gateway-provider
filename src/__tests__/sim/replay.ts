import type { JsonObject, LlmMessage } from 'llm-io';
import { OpenAIChatCompletionsFormat } from 'llm-io';
import {
  CACHE_READ_SAVING_RATE,
  CACHE_WRITE_PREMIUM_RATE,
} from '../../ledger';
import type { FakeGatewayAccounting } from './fake-gateway';
import { FakeGatewayKernel } from './fake-gateway';
import type { ReplayCachePolicy } from './policy';

export interface TrajectoryRequest {
  elapsedMinutes: number;
  messages: readonly LlmMessage[];
}

export interface GoldenTrajectory {
  id: string;
  label: string;
  requests: readonly TrajectoryRequest[];
}

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
  trajectoryId: string;
  trajectoryLabel: string;
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

export async function replayTrajectory(options: {
  kernel: FakeGatewayKernel;
  policy: ReplayCachePolicy;
  trajectory: GoldenTrajectory;
}): Promise<ReplayResult> {
  const { kernel, policy, trajectory } = options;
  const logs: ReplayRequestLog[] = [];
  let atMinute = 0;

  for (let requestIndex = 0; requestIndex < trajectory.requests.length; requestIndex += 1) {
    const request = trajectory.requests[requestIndex];
    if (!Number.isFinite(request.elapsedMinutes) || request.elapsedMinutes < 0) {
      throw new RangeError(
        `Trajectory ${trajectory.id} request ${requestIndex} has invalid elapsedMinutes.`,
      );
    }
    atMinute += request.elapsedMinutes;
    const decision = await policy.apply(request.messages);
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
      netSavedTokens: calculateRequestNetSavedTokens(
        accounting.readTokens,
        accounting.writeTokens,
      ),
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
    trajectoryId: trajectory.id,
    trajectoryLabel: trajectory.label,
  };
}

export function formatScoreboard(results: readonly ReplayResult[]): string {
  const productionResults = results.filter((result) => result.policyName === 'production');
  const kernels = ['calibrated', 'pessimistic', 'optimistic'];
  const rows = productionResults.reduce<Map<string, Map<string, number>>>((table, result) => {
    const row = table.get(result.trajectoryId) ?? new Map<string, number>();
    row.set(result.kernelName, result.totalNetSavedTokens);
    table.set(result.trajectoryId, row);
    return table;
  }, new Map());
  const labels = new Map(
    productionResults.map((result) => [result.trajectoryId, result.trajectoryLabel]),
  );
  const heading = ['trajectory', ...kernels];
  const dataRows = [...rows.entries()].map(([trajectoryId, scores]) => [
    `${trajectoryId} ${labels.get(trajectoryId)}`,
    ...kernels.map((kernel) => {
      const score = scores.get(kernel);
      return score === undefined ? 'missing' : score.toFixed(1);
    }),
  ]);
  const widths = heading.map((cell, columnIndex) =>
    Math.max(cell.length, ...dataRows.map((row) => row[columnIndex].length)),
  );
  const render = (row: readonly string[]) =>
    `| ${row.map((cell, index) => cell.padEnd(widths[index])).join(' | ')} |`;
  return [
    'Offline prompt-cache scoreboard (net token equivalents)',
    render(heading),
    `|-${widths.map((width) => '-'.repeat(width)).join('-|-')}-|`,
    ...dataRows.map(render),
  ].join('\n');
}
