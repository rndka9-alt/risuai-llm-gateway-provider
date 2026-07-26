import type { ReplayResult } from '../../replay';
import type { ContextRotationCell, ContextRotationScenario } from './context-rotation-scenarios';

/**
 * replay 로그를 스칼라 지표로 즉시 투영한다. 220k × 200턴 셀의 requestBody를
 * 보존하면 메모리가 파산하므로, 호출자는 이 요약만 남기고 ReplayResult를 버린다.
 */

export interface ContextRotationRunSummary {
  cacheHitSimulatorName: string;
  cell: ContextRotationCell;
  deficitRequestSharePercent: number;
  hitRequestSharePercent: number;
  // 정상 구간 발동 간격 평균. 발동이 2회 미만이면 null — 결측이 아니라
  // "그 설정에서는 세션 내내 재요약을 겪지 않는다"는 결과다(no-fire).
  observedMeanFiringIntervalTurns: number | null;
  policyName: string;
  quietTurnCapacity: number;
  readSharePercent: number;
  scenarioId: string;
  steadyEfficiencyPercent: number;
  steadyFiringCount: number;
  steadyInputTokens: number;
  steadyRequestCount: number;
  writeSharePercent: number;
}

export function summarizeContextRotationReplay(
  scenario: ContextRotationScenario,
  result: ReplayResult,
): ContextRotationRunSummary {
  const steadyLogs = result.logs.slice(scenario.warmupRequestCount);
  if (steadyLogs.length === 0) {
    throw new Error(`Scenario ${scenario.id} has no requests after the warmup window.`);
  }

  let steadyInputTokens = 0;
  let steadyNetSavedTokens = 0;
  let steadyReadTokens = 0;
  let steadyWriteTokens = 0;
  let hitRequestCount = 0;
  let deficitRequestCount = 0;
  steadyLogs.forEach((log) => {
    steadyInputTokens += log.inputTokens;
    steadyNetSavedTokens += log.netSavedTokens;
    steadyReadTokens += log.readTokens;
    steadyWriteTokens += log.writeTokens;
    if (log.readTokens > 0) hitRequestCount += 1;
    if (log.netSavedTokens < 0) deficitRequestCount += 1;
  });
  if (steadyInputTokens === 0) {
    throw new Error(`Scenario ${scenario.id} accumulated zero steady input tokens.`);
  }

  const steadyFiringIndexes = scenario.firingRequestIndexes.filter(
    (firingIndex) => firingIndex >= scenario.warmupRequestCount,
  );
  const firingIntervals = steadyFiringIndexes
    .slice(1)
    .map((firingIndex, position) => firingIndex - steadyFiringIndexes[position]);

  return {
    cacheHitSimulatorName: result.cacheHitSimulatorName,
    cell: scenario.cell,
    deficitRequestSharePercent: (deficitRequestCount / steadyLogs.length) * 100,
    hitRequestSharePercent: (hitRequestCount / steadyLogs.length) * 100,
    observedMeanFiringIntervalTurns:
      firingIntervals.length === 0
        ? null
        : firingIntervals.reduce((total, interval) => total + interval, 0) /
          firingIntervals.length,
    policyName: result.policyName,
    quietTurnCapacity: scenario.quietTurnCapacity,
    readSharePercent: (steadyReadTokens / steadyInputTokens) * 100,
    scenarioId: result.scenarioId,
    steadyEfficiencyPercent: (steadyNetSavedTokens / steadyInputTokens) * 100,
    steadyFiringCount: steadyFiringIndexes.length,
    steadyInputTokens,
    steadyRequestCount: steadyLogs.length,
    writeSharePercent: (steadyWriteTokens / steadyInputTokens) * 100,
  };
}

export function formatContextRotationTable(
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

function findSummary(
  summaries: readonly ContextRotationRunSummary[],
  predicate: (summary: ContextRotationRunSummary) => boolean,
): ContextRotationRunSummary | undefined {
  return summaries.find(predicate);
}

export function formatEfficiencyMatrixForPolicy(
  summaries: readonly ContextRotationRunSummary[],
  options: {
    arm: ContextRotationCell['arm'];
    policyName: string;
    ratios: readonly number[];
  },
): string {
  const armSummaries = summaries.filter(
    (summary) => summary.cell.arm === options.arm && summary.policyName === options.policyName,
  );
  const maxContextValues = [...new Set(armSummaries.map((summary) => summary.cell.maxContextTokens))].sort(
    (left, right) => left - right,
  );
  const includeTrimColumn = armSummaries.some((summary) => summary.cell.memoryMode === 'trim-only');

  const heading = [
    'M \\ r',
    ...(includeTrimColumn ? ['trim'] : []),
    ...options.ratios.map((ratio) => ratio.toFixed(2)),
  ];
  const dataRows = maxContextValues.map((maxContextTokens) => {
    const trimCells = includeTrimColumn
      ? [
          formatEfficiencyCell(
            findSummary(
              armSummaries,
              (summary) =>
                summary.cell.maxContextTokens === maxContextTokens &&
                summary.cell.memoryMode === 'trim-only',
            ),
          ),
        ]
      : [];
    return [
      `${Math.round(maxContextTokens / 1_000)}k`,
      ...trimCells,
      ...options.ratios.map((ratio) =>
        formatEfficiencyCell(
          findSummary(
            armSummaries,
            (summary) =>
              summary.cell.maxContextTokens === maxContextTokens &&
              summary.cell.memoryMode === 'hypa' &&
              summary.cell.extraSummarizationRatio === ratio,
          ),
        ),
      ),
    ];
  });

  return formatContextRotationTable(
    `[${options.arm}] ${options.policyName} — steady net/input (%)`,
    heading,
    dataRows,
  );
}

function formatEfficiencyCell(summary: ContextRotationRunSummary | undefined): string {
  if (summary === undefined) return '—';
  return `${summary.steadyEfficiencyPercent.toFixed(1)}%`;
}

export function formatDutyCycleTable(
  summaries: readonly ContextRotationRunSummary[],
  policyName: string,
): string {
  const dutySummaries = summaries
    .filter(
      (summary) =>
        summary.policyName === policyName &&
        summary.cell.memoryMode === 'hypa' &&
        summary.cell.arm === 'core',
    )
    .sort((left, right) =>
      left.cell.maxContextTokens === right.cell.maxContextTokens
        ? left.cell.extraSummarizationRatio - right.cell.extraSummarizationRatio
        : left.cell.maxContextTokens - right.cell.maxContextTokens,
    );

  return formatContextRotationTable(
    `duty cycle — 예측 k vs 실측 발동 간격 (${policyName}, steady 구간)`,
    ['cell', 'k(예측)', '발동 수', '실측 간격', 'read/input', 'write/input', 'hit율'],
    dutySummaries.map((summary) => [
      summary.cell.id,
      String(summary.quietTurnCapacity),
      String(summary.steadyFiringCount),
      summary.observedMeanFiringIntervalTurns === null
        ? 'no-fire'
        : summary.observedMeanFiringIntervalTurns.toFixed(1),
      `${summary.readSharePercent.toFixed(1)}%`,
      `${summary.writeSharePercent.toFixed(1)}%`,
      `${summary.hitRequestSharePercent.toFixed(0)}%`,
    ]),
  );
}
