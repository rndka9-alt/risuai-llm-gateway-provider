import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  CORE_EXTRA_SUMMARIZATION_RATIOS,
  ISOTROPIC_EXTRA_SUMMARIZATION_RATIOS,
  createContextRotationCell,
  createContextRotationScenario,
  createCoreContextRotationScenarios,
  createIsotropicContextRotationScenarios,
  listInfeasibleCoreCells,
} from './context-rotation-scenarios';
import {
  formatContextRotationTable,
  formatDutyCycleTable,
  formatEfficiencyMatrixForPolicy,
  type ContextRotationRunSummary,
} from './context-rotation-metrics';
import {
  FULL_POLICY_FACTORIES,
  SMOKE_POLICY_FACTORIES,
  replayContextRotationCell,
} from './context-rotation-harness';

// 스모크는 32k 셀 2개만 재생해 생성기·오라클·지표 계약이 살아 있는지 지킨다.
// 전체 격자는 CONTEXT_ROTATION=full로만 실행한다(실행 시간·메모리가 크다):
//   CONTEXT_ROTATION=full npx vitest run src/__tests__/sim/experiments/context-rotation

describe('context-rotation 스모크', () => {
  // r=0 셀은 매턴 발동 축퇴 레짐을, 등방 iso 셀은 quiet 구간의 심층 frontier
  // 수확 경로를 각각 커버한다. 32k에서 r>0 core 셀은 설정 불가라 iso로 대신한다.
  const hypaScenario = createContextRotationScenario(
    createContextRotationCell({
      arm: 'core',
      extraSummarizationRatio: 0,
      maxContextTokens: 32_000,
      memoryMode: 'hypa',
    }),
  );
  const trimScenario = createContextRotationScenario(
    createContextRotationCell({
      arm: 'core',
      extraSummarizationRatio: 0,
      maxContextTokens: 32_000,
      memoryMode: 'trim-only',
    }),
  );
  const isotropicScenario = createContextRotationScenario(
    createContextRotationCell({
      arm: 'isotropic',
      extraSummarizationRatio: 0.1,
      maxContextTokens: 32_000,
      memoryMode: 'hypa',
    }),
  );
  const smokeScenarios = [hypaScenario, trimScenario, isotropicScenario];
  const summaries: ContextRotationRunSummary[] = [];

  beforeAll(async () => {
    for (const scenario of smokeScenarios) {
      summaries.push(...(await replayContextRotationCell(scenario, SMOKE_POLICY_FACTORIES)));
    }
  }, 300_000);

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('hypa 셀은 워밍 스타트 직후부터 예산 트리거로 반복 발동한다', () => {
    expect(hypaScenario.requests).toHaveLength(80);
    expect(hypaScenario.firingRequestIndexes.length).toBeGreaterThanOrEqual(50);
    expect(hypaScenario.firingRequestIndexes[0]).toBeLessThanOrEqual(5);
    expect(trimScenario.firingRequestIndexes).toHaveLength(0);
    // iso r=0.1은 k=10 듀티 사이클 — 발동 사이 quiet 구간이 실제로 생겨야 한다.
    expect(isotropicScenario.quietTurnCapacity).toBe(10);
    expect(isotropicScenario.firingRequestIndexes.length).toBeGreaterThanOrEqual(2);
  });

  it('생존 프리픽스는 불변 헤드 아래로 내려가지 않는다', () => {
    smokeScenarios.forEach((scenario) => {
      scenario.survivingPrefixMessageCounts.forEach((count, requestIndex) => {
        if (requestIndex === scenario.survivingPrefixMessageCounts.length - 1) {
          expect(count).toBe(0);
        } else {
          expect(count).toBeGreaterThanOrEqual(scenario.headMessageCount);
        }
      });
    });
  });

  it('no-cache는 read/write를 만들지 않는다', () => {
    const noCacheSummaries = summaries.filter((summary) => summary.policyName === 'no-cache');
    expect(noCacheSummaries).toHaveLength(smokeScenarios.length);
    noCacheSummaries.forEach((summary) => {
      expect(summary.readSharePercent).toBe(0);
      expect(summary.writeSharePercent).toBe(0);
      expect(summary.steadyEfficiencyPercent).toBe(0);
    });
  });

  it('오라클 봉투는 정상 구간에서 히트를 만든다', () => {
    const oracleSummaries = summaries.filter((summary) =>
      summary.policyName.startsWith('oracle-'),
    );
    expect(oracleSummaries).toHaveLength(smokeScenarios.length * 2);
    oracleSummaries.forEach((summary) => {
      expect(summary.hitRequestSharePercent).toBeGreaterThan(0);
      expect(summary.readSharePercent).toBeGreaterThan(0);
    });
  });
});

describe.runIf(process.env.CONTEXT_ROTATION === 'full')('context-rotation 전체 격자', () => {
  const summaries: ContextRotationRunSummary[] = [];
  let scenarioCount = 0;

  beforeAll(async () => {
    const scenarios = [
      ...createCoreContextRotationScenarios(),
      ...createIsotropicContextRotationScenarios(),
    ];
    scenarioCount = scenarios.length;
    for (const scenario of scenarios) {
      summaries.push(...(await replayContextRotationCell(scenario, FULL_POLICY_FACTORIES)));
      console.log(`[context-rotation] ${scenario.id} 완료 (${scenario.requests.length}요청)`);
    }
  }, 7_200_000);

  afterAll(() => {
    vi.unstubAllGlobals();
    console.log(`\n${formatFullReport(summaries)}\n`);
  });

  it('실행 가능한 모든 셀이 전 정책에서 재생된다', () => {
    expect(summaries).toHaveLength(scenarioCount * FULL_POLICY_FACTORIES.length);
  });

  it('설정 불가 셀은 사전 산정한 저컨텍스트 대각선뿐이다', () => {
    // memoryTokensRatio 캡을 반영한 정상 상태 하한 기준. 32k에서 r>0 전체와
    // 70k×0.5가 탈락하는 것 자체가 "저컨텍스트에서는 추가 요약 여유가 없다"는 결과다.
    const infeasibleCells = listInfeasibleCoreCells();
    expect(
      infeasibleCells.map((cell) => `${cell.maxContextTokens}:${cell.extraSummarizationRatio}`),
    ).toEqual([
      '32000:0.05',
      '32000:0.1',
      '32000:0.2',
      '32000:0.35',
      '32000:0.5',
      '70000:0.5',
    ]);
  });
});

function formatFullReport(summaries: readonly ContextRotationRunSummary[]): string {
  const reportParts: string[] = [];
  ['production', 'v013-single-slot', 'oracle-stable-head', 'oracle-surviving-frontier'].forEach(
    (policyName) => {
      reportParts.push(
        formatEfficiencyMatrixForPolicy(summaries, {
          arm: 'core',
          policyName,
          ratios: CORE_EXTRA_SUMMARIZATION_RATIOS,
        }),
      );
    },
  );
  reportParts.push(
    formatEfficiencyMatrixForPolicy(summaries, {
      arm: 'isotropic',
      policyName: 'production',
      ratios: ISOTROPIC_EXTRA_SUMMARIZATION_RATIOS,
    }),
  );
  reportParts.push(formatDutyCycleTable(summaries, 'production'));
  reportParts.push(formatRegimeDirectionReport(summaries));
  reportParts.push(
    listInfeasibleCoreCells()
      .map(
        (cell) =>
          `설정 불가: M=${cell.maxContextTokens.toLocaleString()} r=${cell.extraSummarizationRatio} — ${cell.reason}`,
      )
      .join('\n'),
  );
  return reportParts.join('\n\n');
}

// 판정 입력값 표. D4(∂eff/∂M 부호가 r에 따라 뒤집히는가), D7(hypa r=0 ≈ trim-only
// 체크섬), D1(등방 잔차 ≤ 1.0pp) — 판정 임계는 설계 문서에 사전 고정돼 있고
// 여기서는 수치만 낸다.
function formatRegimeDirectionReport(summaries: readonly ContextRotationRunSummary[]): string {
  const productionCore = summaries.filter(
    (summary) => summary.policyName === 'production' && summary.cell.arm === 'core',
  );
  const maxContextValues = [
    ...new Set(productionCore.map((summary) => summary.cell.maxContextTokens)),
  ].sort((left, right) => left - right);

  const findHypaEfficiency = (maxContextTokens: number, ratio: number): number | null => {
    const summary = productionCore.find(
      (candidate) =>
        candidate.cell.memoryMode === 'hypa' &&
        candidate.cell.maxContextTokens === maxContextTokens &&
        candidate.cell.extraSummarizationRatio === ratio,
    );
    return summary === undefined ? null : summary.steadyEfficiencyPercent;
  };

  // 저컨텍스트에는 설정 불가 비율이 있으므로 방향 판정은 비율별로 실행 가능한
  // 양 끝 M 사이에서 잰다.
  const signTable = formatContextRotationTable(
    'D4 입력 — production eff의 M 방향 (비율별 실행 가능한 최소 M → 최대 M)',
    ['r', '구간', 'eff@최소M', 'eff@최대M', 'Δ(pp)'],
    CORE_EXTRA_SUMMARIZATION_RATIOS.map((ratio) => {
      const feasibleMaxContexts = maxContextValues.filter(
        (maxContextTokens) => findHypaEfficiency(maxContextTokens, ratio) !== null,
      );
      if (feasibleMaxContexts.length < 2) {
        return [ratio.toFixed(2), '—', '—', '—', '—'];
      }
      const lowestMaxContext = feasibleMaxContexts[0];
      const highestMaxContext = feasibleMaxContexts[feasibleMaxContexts.length - 1];
      const lowEfficiency = findHypaEfficiency(lowestMaxContext, ratio);
      const highEfficiency = findHypaEfficiency(highestMaxContext, ratio);
      if (lowEfficiency === null || highEfficiency === null) {
        return [ratio.toFixed(2), '—', '—', '—', '—'];
      }
      const difference = highEfficiency - lowEfficiency;
      return [
        ratio.toFixed(2),
        `${lowestMaxContext / 1_000}k→${highestMaxContext / 1_000}k`,
        `${lowEfficiency.toFixed(1)}%`,
        `${highEfficiency.toFixed(1)}%`,
        `${difference > 0 ? '+' : ''}${difference.toFixed(1)}pp`,
      ];
    }),
  );

  const checksumTable = formatContextRotationTable(
    'D7 입력 — hypa r=0 vs trim-only (production, ≤ 2pp면 생성기 모델 유효)',
    ['M', 'hypa r=0', 'trim-only', 'Δ(pp)'],
    maxContextValues.map((maxContextTokens) => {
      const hypaZeroEfficiency = findHypaEfficiency(maxContextTokens, 0);
      const trimSummary = productionCore.find(
        (candidate) =>
          candidate.cell.memoryMode === 'trim-only' &&
          candidate.cell.maxContextTokens === maxContextTokens,
      );
      if (hypaZeroEfficiency === null || trimSummary === undefined) {
        return [`${maxContextTokens / 1_000}k`, '—', '—', '—'];
      }
      const difference = hypaZeroEfficiency - trimSummary.steadyEfficiencyPercent;
      return [
        `${maxContextTokens / 1_000}k`,
        `${hypaZeroEfficiency.toFixed(1)}%`,
        `${trimSummary.steadyEfficiencyPercent.toFixed(1)}%`,
        `${difference > 0 ? '+' : ''}${difference.toFixed(1)}pp`,
      ];
    }),
  );

  const isotropicProduction = summaries.filter(
    (summary) => summary.policyName === 'production' && summary.cell.arm === 'isotropic',
  );
  const residualTable = formatContextRotationTable(
    'D1 입력 — 등방 arm 잔차 (production, > 1.0pp면 절대 임계 개입)',
    ['r', 'min eff', 'max eff', '잔차(pp)'],
    ISOTROPIC_EXTRA_SUMMARIZATION_RATIOS.map((ratio) => {
      const efficiencies = isotropicProduction
        .filter((summary) => summary.cell.extraSummarizationRatio === ratio)
        .map((summary) => summary.steadyEfficiencyPercent);
      if (efficiencies.length === 0) return [ratio.toFixed(2), '—', '—', '—'];
      const minimum = Math.min(...efficiencies);
      const maximum = Math.max(...efficiencies);
      return [
        ratio.toFixed(2),
        `${minimum.toFixed(1)}%`,
        `${maximum.toFixed(1)}%`,
        (maximum - minimum).toFixed(2),
      ];
    }),
  );

  return [signTable, checksumTable, residualTable].join('\n\n');
}
