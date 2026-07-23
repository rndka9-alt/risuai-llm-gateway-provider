import type { JsonObject, LlmMessage } from 'llm-io';
import { OpenAIChatCompletionsFormat } from 'llm-io';
import { CACHE_READ_SAVING_RATE, CACHE_WRITE_PREMIUM_RATE } from '../../ledger';
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

const SCOREBOARD_KERNELS = ['calibrated', 'pessimistic', 'optimistic'];
const MULTI_ROOM_TRAJECTORY_IDS: ReadonlySet<string> = new Set([
  '15-multi-room-roundrobin',
  '16-group-speaker-rotation',
  '21-content-addressed-roundrobin',
  '22-cross-churn-eviction',
]);

export function isMultiRoomGoldenTrajectory(trajectoryId: string): boolean {
  return MULTI_ROOM_TRAJECTORY_IDS.has(trajectoryId);
}
const SCOREBOARD_POLICIES = [
  'legacy-production',
  'validated-all',
  'selective-hard-cap',
  'production-two-survival',
  'v013-single-slot',
  'production',
  'adaptive-2strike',
  'adaptive-2strike-reroll-aware',
  'first-turn-safe',
  'no-cache',
];

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
    trajectoryId: trajectory.id,
    trajectoryLabel: trajectory.label,
  };
}

function formatTable(
  title: string,
  heading: readonly string[],
  dataRows: readonly (readonly string[])[],
): string {
  const widths = heading.map((cell, columnIndex) =>
    Math.max(cell.length, ...dataRows.map((row) => row[columnIndex].length)),
  );
  const render = (row: readonly string[]) =>
    `| ${row.map((cell, index) => cell.padEnd(widths[index])).join(' | ')} |`;
  return [
    title,
    render(heading),
    `|-${widths.map((width) => '-'.repeat(width)).join('-|-')}-|`,
    ...dataRows.map(render),
  ].join('\n');
}

function createScoreIndex(
  results: readonly ReplayResult[],
): Map<string, Map<string, Map<string, number>>> {
  const index = new Map<string, Map<string, Map<string, number>>>();
  results.forEach((result) => {
    const trajectoryScores = index.get(result.trajectoryId) ?? new Map();
    const policyScores = trajectoryScores.get(result.policyName) ?? new Map();
    policyScores.set(result.kernelName, result.totalNetSavedTokens);
    trajectoryScores.set(result.policyName, policyScores);
    index.set(result.trajectoryId, trajectoryScores);
  });
  return index;
}

function formatScore(score: number | undefined): string {
  return score === undefined ? 'missing' : score.toFixed(1);
}

function formatPolicyTotals(results: readonly ReplayResult[]): string {
  const calibratedResults = results.filter((result) => result.kernelName === 'calibrated');
  const scopes = [
    {
      label: 'multi-room (15/16/21/22)',
      matches: (result: ReplayResult) => isMultiRoomGoldenTrajectory(result.trajectoryId),
    },
    {
      label: 'single-room (remaining 23)',
      matches: (result: ReplayResult) => !isMultiRoomGoldenTrajectory(result.trajectoryId),
    },
    { label: 'all (27)', matches: () => true },
  ];
  const totals = SCOREBOARD_POLICIES.flatMap((policyName) =>
    scopes.map((scope) => {
      const scopedResults = calibratedResults.filter(
        (result) => result.policyName === policyName && scope.matches(result),
      );
      return {
        netSavedTokens: scopedResults.reduce(
          (total, result) => total + result.totalNetSavedTokens,
          0,
        ),
        policyName,
        readTokens: scopedResults.reduce((total, result) => total + result.totalReadTokens, 0),
        scopeLabel: scope.label,
        writeTokens: scopedResults.reduce((total, result) => total + result.totalWriteTokens, 0),
      };
    }),
  );

  return formatTable(
    'Calibrated policy totals by workload scope',
    ['policy', 'scope', 'net', 'vs v0.13', 'read', 'write'],
    totals.map((total) => {
      const v013Total = totals.find(
        (candidate) =>
          candidate.policyName === 'v013-single-slot' && candidate.scopeLabel === total.scopeLabel,
      );
      if (v013Total === undefined) {
        throw new Error(`Missing v013-single-slot score for ${total.scopeLabel}.`);
      }
      return [
        total.policyName,
        total.scopeLabel,
        total.netSavedTokens.toFixed(1),
        (total.netSavedTokens - v013Total.netSavedTokens).toFixed(1),
        total.readTokens.toFixed(0),
        total.writeTokens.toFixed(0),
      ];
    }),
  );
}

function formatRankingReversals(
  trajectoryOrder: readonly string[],
  labels: ReadonlyMap<string, string>,
  scores: ReadonlyMap<string, ReadonlyMap<string, ReadonlyMap<string, number>>>,
): string {
  const reversals: string[] = [];
  trajectoryOrder.forEach((trajectoryId) => {
    const trajectoryScores = scores.get(trajectoryId);
    if (trajectoryScores === undefined) return;

    for (let leftIndex = 0; leftIndex < SCOREBOARD_POLICIES.length; leftIndex += 1) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < SCOREBOARD_POLICIES.length;
        rightIndex += 1
      ) {
        const leftPolicy = SCOREBOARD_POLICIES[leftIndex];
        const rightPolicy = SCOREBOARD_POLICIES[rightIndex];
        const comparisons = SCOREBOARD_KERNELS.map((kernel) => {
          const leftScore = trajectoryScores.get(leftPolicy)?.get(kernel);
          const rightScore = trajectoryScores.get(rightPolicy)?.get(kernel);
          if (leftScore === undefined || rightScore === undefined) return 0;
          return Math.sign(leftScore - rightScore);
        });
        if (!comparisons.includes(-1) || !comparisons.includes(1)) continue;

        const comparisonSummary = SCOREBOARD_KERNELS.map((kernel, kernelIndex) => {
          const comparison = comparisons[kernelIndex];
          const relation = comparison > 0 ? '>' : comparison < 0 ? '<' : '=';
          return `${kernel}:${leftPolicy}${relation}${rightPolicy}`;
        }).join(', ');
        reversals.push(`- ${trajectoryId} ${labels.get(trajectoryId)}: ${comparisonSummary}`);
      }
    }
  });

  return ['Kernel ranking reversals', ...(reversals.length === 0 ? ['- none'] : reversals)].join(
    '\n',
  );
}

export function formatScoreboard(results: readonly ReplayResult[]): string {
  const productionResults = results.filter((result) => result.policyName === 'production');
  const trajectoryOrder = [...new Set(productionResults.map((result) => result.trajectoryId))];
  const labels = new Map(
    productionResults.map((result) => [result.trajectoryId, result.trajectoryLabel]),
  );
  const scores = createScoreIndex(results);
  const trajectoryLabel = (trajectoryId: string): string => {
    const label = labels.get(trajectoryId);
    if (label === undefined) {
      throw new Error(`Missing trajectory label for ${trajectoryId}.`);
    }
    return `${trajectoryId} ${label}`;
  };

  const productionRows = trajectoryOrder.map((trajectoryId) => {
    const productionScores = scores.get(trajectoryId)?.get('production');
    return [
      trajectoryLabel(trajectoryId),
      ...SCOREBOARD_KERNELS.map((kernel) => formatScore(productionScores?.get(kernel))),
    ];
  });
  const policyRows = trajectoryOrder.map((trajectoryId) => {
    const trajectoryScores = scores.get(trajectoryId);
    return [
      trajectoryLabel(trajectoryId),
      ...SCOREBOARD_POLICIES.map((policy) =>
        formatScore(trajectoryScores?.get(policy)?.get('calibrated')),
      ),
    ];
  });

  return [
    formatPolicyTotals(results),
    formatTable(
      'Production by kernel (net token equivalents)',
      ['trajectory', ...SCOREBOARD_KERNELS],
      productionRows,
    ),
    formatTable(
      'Calibrated policy comparison (net token equivalents)',
      ['trajectory', ...SCOREBOARD_POLICIES],
      policyRows,
    ),
    formatRankingReversals(trajectoryOrder, labels, scores),
  ].join('\n\n');
}
