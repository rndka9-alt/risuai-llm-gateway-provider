import type { ReplayResult } from '../replay';

const SCOREBOARD_KERNELS = ['calibrated', 'pessimistic', 'optimistic'];
const MULTI_ROOM_SCENARIO_IDS: ReadonlySet<string> = new Set([
  '15-multi-room-roundrobin',
  '16-group-speaker-rotation',
  '21-content-addressed-roundrobin',
  '22-cross-churn-eviction',
]);
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

export function isMultiRoomCanonicalScenario(scenarioId: string): boolean {
  return MULTI_ROOM_SCENARIO_IDS.has(scenarioId);
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
    const scenarioScores = index.get(result.scenarioId) ?? new Map();
    const policyScores = scenarioScores.get(result.policyName) ?? new Map();
    policyScores.set(result.kernelName, result.totalNetSavedTokens);
    scenarioScores.set(result.policyName, policyScores);
    index.set(result.scenarioId, scenarioScores);
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
      matches: (result: ReplayResult) => isMultiRoomCanonicalScenario(result.scenarioId),
    },
    {
      label: 'single-room (remaining 23)',
      matches: (result: ReplayResult) => !isMultiRoomCanonicalScenario(result.scenarioId),
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
    'Calibrated policy totals by scenario scope',
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
  scenarioOrder: readonly string[],
  labels: ReadonlyMap<string, string>,
  scores: ReadonlyMap<string, ReadonlyMap<string, ReadonlyMap<string, number>>>,
): string {
  const reversals: string[] = [];
  scenarioOrder.forEach((scenarioId) => {
    const scenarioScores = scores.get(scenarioId);
    if (scenarioScores === undefined) return;

    for (let leftIndex = 0; leftIndex < SCOREBOARD_POLICIES.length; leftIndex += 1) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < SCOREBOARD_POLICIES.length;
        rightIndex += 1
      ) {
        const leftPolicy = SCOREBOARD_POLICIES[leftIndex];
        const rightPolicy = SCOREBOARD_POLICIES[rightIndex];
        const comparisons = SCOREBOARD_KERNELS.map((kernel) => {
          const leftScore = scenarioScores.get(leftPolicy)?.get(kernel);
          const rightScore = scenarioScores.get(rightPolicy)?.get(kernel);
          if (leftScore === undefined || rightScore === undefined) return 0;
          return Math.sign(leftScore - rightScore);
        });
        if (!comparisons.includes(-1) || !comparisons.includes(1)) continue;

        const comparisonSummary = SCOREBOARD_KERNELS.map((kernel, kernelIndex) => {
          const comparison = comparisons[kernelIndex];
          const relation = comparison > 0 ? '>' : comparison < 0 ? '<' : '=';
          return `${kernel}:${leftPolicy}${relation}${rightPolicy}`;
        }).join(', ');
        reversals.push(`- ${scenarioId} ${labels.get(scenarioId)}: ${comparisonSummary}`);
      }
    }
  });

  return ['Kernel ranking reversals', ...(reversals.length === 0 ? ['- none'] : reversals)].join(
    '\n',
  );
}

export function formatScoreboard(results: readonly ReplayResult[]): string {
  const productionResults = results.filter((result) => result.policyName === 'production');
  const scenarioOrder = [...new Set(productionResults.map((result) => result.scenarioId))];
  const labels = new Map(
    productionResults.map((result) => [result.scenarioId, result.scenarioLabel]),
  );
  const scores = createScoreIndex(results);
  const scenarioLabel = (scenarioId: string): string => {
    const label = labels.get(scenarioId);
    if (label === undefined) {
      throw new Error(`Missing scenario label for ${scenarioId}.`);
    }
    return `${scenarioId} ${label}`;
  };

  const productionRows = scenarioOrder.map((scenarioId) => {
    const productionScores = scores.get(scenarioId)?.get('production');
    return [
      scenarioLabel(scenarioId),
      ...SCOREBOARD_KERNELS.map((kernel) => formatScore(productionScores?.get(kernel))),
    ];
  });
  const policyRows = scenarioOrder.map((scenarioId) => {
    const scenarioScores = scores.get(scenarioId);
    return [
      scenarioLabel(scenarioId),
      ...SCOREBOARD_POLICIES.map((policy) =>
        formatScore(scenarioScores?.get(policy)?.get('calibrated')),
      ),
    ];
  });

  return [
    formatPolicyTotals(results),
    formatTable(
      'Production by kernel (net token equivalents)',
      ['scenario', ...SCOREBOARD_KERNELS],
      productionRows,
    ),
    formatTable(
      'Calibrated policy comparison (net token equivalents)',
      ['scenario', ...SCOREBOARD_POLICIES],
      policyRows,
    ),
    formatRankingReversals(scenarioOrder, labels, scores),
  ].join('\n\n');
}
