import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createFakeGatewayKernel, type FakeGatewayKernelPreset } from './fake-gateway';
import {
  createMiddleBlockTrajectories,
  MIDDLE_BLOCK_POLICY_FACTORIES,
  type MiddleBlockPolicyFactory,
  type MiddleBlockTrajectory,
} from './middle-block-anchor-experiment';
import { createNoCachePolicy, createProductionCachePolicy, type ReplayCachePolicy } from './policy';
import { replayTrajectory, type ReplayResult } from './replay';
import { createV013SingleSlotCachePolicy } from './v013-single-slot-policy';

const KERNEL_PRESETS = ['calibrated', 'pessimistic'] satisfies readonly FakeGatewayKernelPreset[];

interface PolicyFactory {
  create: () => ReplayCachePolicy;
  name: ReplayCachePolicy['name'];
}

const POLICY_FACTORIES: readonly PolicyFactory[] = [
  // 이전 릴리즈(v0.13) 실배포 정책 — "지금보다 효율적인가"가 아니라
  // "이전 릴리즈보다 좋아졌는가"를 같은 trajectory에서 답하기 위한 기준선.
  { create: createV013SingleSlotCachePolicy, name: 'v013-single-slot' },
  { create: createProductionCachePolicy, name: 'production' },
  ...MIDDLE_BLOCK_POLICY_FACTORIES,
  { create: createNoCachePolicy, name: 'no-cache' },
];

const trajectories = createMiddleBlockTrajectories();
const pluginStorage = new Map<string, string>();
const results: ReplayResult[] = [];

function stubPluginStorage(): void {
  vi.stubGlobal('risuai', {
    pluginStorage: {
      getItem: async (key: string) => pluginStorage.get(key) ?? null,
      setItem: async (key: string, value: string) => {
        pluginStorage.set(key, value);
      },
    },
  });
}

function resultFor(
  trajectoryId: string,
  kernelName: FakeGatewayKernelPreset,
  policyName: string,
): ReplayResult {
  const result = results.find(
    (candidate) =>
      candidate.trajectoryId === trajectoryId &&
      candidate.kernelName === kernelName &&
      candidate.policyName === policyName,
  );
  if (result === undefined) {
    throw new Error(`Missing result for ${trajectoryId}/${kernelName}/${policyName}.`);
  }
  return result;
}

function efficiency(result: ReplayResult): number {
  return (result.totalNetSavedTokens / result.totalInputTokens) * 100;
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

function formatPerTrajectoryScoreboard(): string {
  const comparedPolicyNames = POLICY_FACTORIES.filter((factory) => factory.name !== 'no-cache').map(
    (factory) => factory.name,
  );

  return formatTable(
    'Middle-block anchor oracle — calibrated net/input',
    ['trajectory', ...comparedPolicyNames, 'winner', 'vs production'],
    trajectories.map((trajectory) => {
      const policyResults = comparedPolicyNames.map((policyName) =>
        resultFor(trajectory.id, 'calibrated', policyName),
      );
      const winner = policyResults.reduce((best, candidate) =>
        candidate.totalNetSavedTokens > best.totalNetSavedTokens ? candidate : best,
      );
      const production = resultFor(trajectory.id, 'calibrated', 'production');
      return [
        trajectory.id,
        ...policyResults.map((result) => `${efficiency(result).toFixed(1)}%`),
        winner.policyName,
        `${(efficiency(winner) - efficiency(production)).toFixed(1)}pp`,
      ];
    }),
  );
}

function formatScopeScoreboards(): string {
  const scopes: readonly {
    label: string;
    matches: (trajectory: MiddleBlockTrajectory) => boolean;
  }[] = [
    {
      label: 'recurrent within TTL',
      matches: (trajectory) =>
        trajectory.phaseCount !== null &&
        trajectory.phaseCount * trajectory.switchEveryTurns * 2 < 30,
    },
    {
      label: 'recurrent after TTL',
      matches: (trajectory) =>
        trajectory.phaseCount !== null &&
        trajectory.phaseCount * trajectory.switchEveryTurns * 2 >= 30,
    },
    {
      label: 'unique churn',
      matches: (trajectory) => trajectory.phaseCount === null,
    },
    {
      label: 'all',
      matches: () => true,
    },
  ];

  return KERNEL_PRESETS.map((kernelName) =>
    formatTable(
      `Middle-block anchor oracle — ${kernelName} totals`,
      ['policy', 'scope', 'net/input', 'read', 'write'],
      POLICY_FACTORIES.flatMap((factory) =>
        scopes.map((scope) => {
          const scopedTrajectories = trajectories.filter(scope.matches);
          const scopedResults = scopedTrajectories.map((trajectory) =>
            resultFor(trajectory.id, kernelName, factory.name),
          );
          const inputTokens = scopedResults.reduce(
            (total, result) => total + result.totalInputTokens,
            0,
          );
          const netSavedTokens = scopedResults.reduce(
            (total, result) => total + result.totalNetSavedTokens,
            0,
          );
          return [
            factory.name,
            scope.label,
            `${((netSavedTokens / inputTokens) * 100).toFixed(2)}%`,
            scopedResults.reduce((total, result) => total + result.totalReadTokens, 0).toFixed(0),
            scopedResults.reduce((total, result) => total + result.totalWriteTokens, 0).toFixed(0),
          ];
        }),
      ),
    ),
  ).join('\n\n');
}

beforeAll(async () => {
  stubPluginStorage();
  for (const trajectory of trajectories) {
    for (const kernelPreset of KERNEL_PRESETS) {
      for (const factory of POLICY_FACTORIES) {
        pluginStorage.clear();
        stubPluginStorage();
        results.push(
          await replayTrajectory({
            kernel: createFakeGatewayKernel(kernelPreset),
            policy: factory.create(),
            trajectory,
          }),
        );
      }
    }
  }
  console.log([formatPerTrajectoryScoreboard(), formatScopeScoreboards()].join('\n\n'));
}, 300_000);

afterAll(() => {
  vi.unstubAllGlobals();
});

describe('middle-block semantic anchor oracle', () => {
  it('모든 trajectory × kernel × policy 결과를 수집한다', () => {
    expect(results).toHaveLength(
      trajectories.length * KERNEL_PRESETS.length * POLICY_FACTORIES.length,
    );
  });

  it('모든 후보가 회계·와이어 불변식을 지킨다', () => {
    results.forEach((result) => {
      expect(Number.isFinite(result.totalNetSavedTokens)).toBe(true);
      result.logs.forEach((log) => {
        expect(log.readTokens + log.writeTokens).toBeLessThanOrEqual(log.inputTokens);
        expect(log.wireMarkerCount).toBeLessThanOrEqual(4);
        expect(log.wireMarkerRoles).not.toContain('assistant');
      });
    });
  });

  it('no-cache 기준선에는 read와 write가 없다', () => {
    results
      .filter((result) => result.policyName === 'no-cache')
      .forEach((result) => {
        expect(result.totalReadTokens).toBe(0);
        expect(result.totalWriteTokens).toBe(0);
        expect(result.totalNetSavedTokens).toBe(0);
      });
  });

  it('실험 정책 factory 이름과 실제 정책 이름이 일치한다', () => {
    const experimentalFactories: readonly MiddleBlockPolicyFactory[] =
      MIDDLE_BLOCK_POLICY_FACTORIES;
    experimentalFactories.forEach((factory) => {
      expect(factory.create().name).toBe(factory.name);
    });
  });

  it('TTL 안에 phase가 재등장하면 전체 phase-recall이 production보다 유리하다', () => {
    trajectories
      .filter(
        (trajectory) =>
          trajectory.phaseCount !== null &&
          trajectory.phaseCount * trajectory.switchEveryTurns * 2 < 30,
      )
      .forEach((trajectory) => {
        const production = resultFor(trajectory.id, 'calibrated', 'production');
        const fullRecall = resultFor(trajectory.id, 'calibrated', 'oracle-shield-phase-recall');
        expect(fullRecall.totalNetSavedTokens).toBeGreaterThan(production.totalNetSavedTokens);
      });
  });

  it('TTL 밖 재등장과 unique churn에서는 TTL-aware admission이 방패-only로 강하한다', () => {
    trajectories
      .filter(
        (trajectory) =>
          trajectory.phaseCount === null ||
          trajectory.phaseCount * trajectory.switchEveryTurns * 2 >= 30,
      )
      .forEach((trajectory) => {
        for (const kernelPreset of KERNEL_PRESETS) {
          const shield = resultFor(trajectory.id, kernelPreset, 'oracle-shield');
          const ttlAware = resultFor(trajectory.id, kernelPreset, 'oracle-ttl-recurrence-admitted');
          expect(ttlAware.totalNetSavedTokens).toBeCloseTo(shield.totalNetSavedTokens);
        }
      });
  });

  it('TTL-aware admission은 전체 스윕에서 production보다 높은 순절감을 낸다', () => {
    for (const kernelPreset of KERNEL_PRESETS) {
      const productionNet = trajectories.reduce(
        (total, trajectory) =>
          total + resultFor(trajectory.id, kernelPreset, 'production').totalNetSavedTokens,
        0,
      );
      const ttlAwareNet = trajectories.reduce(
        (total, trajectory) =>
          total +
          resultFor(trajectory.id, kernelPreset, 'oracle-ttl-recurrence-admitted')
            .totalNetSavedTokens,
        0,
      );
      expect(ttlAwareNet).toBeGreaterThan(productionNet);
    }
  });

  it('admission 후보들은 모든 trajectory에서 이전 릴리즈(v0.13)보다 순절감이 낮지 않다', () => {
    // "지금 production보다 나은가"와 별개로, 후보 전략이 실배포됐던 어느
    // 릴리즈보다도 뒤로 가지 않는지를 릴리즈 안전선으로 고정한다.
    const candidatePolicyNames = [
      'oracle-ttl-recurrence-admitted',
      'oracle-wallclock-recurrence-admitted',
    ] as const;
    trajectories.forEach((trajectory) => {
      for (const kernelPreset of KERNEL_PRESETS) {
        const previousRelease = resultFor(trajectory.id, kernelPreset, 'v013-single-slot');
        for (const candidatePolicyName of candidatePolicyNames) {
          const candidate = resultFor(trajectory.id, kernelPreset, candidatePolicyName);
          expect(candidate.totalNetSavedTokens).toBeGreaterThanOrEqual(
            previousRelease.totalNetSavedTokens,
          );
        }
      }
    });
  });

  it('production은 TTL 밖 16상태 회전에서 이전 릴리즈(v0.13)보다 퇴행해 있다', () => {
    // 깊은 write가 전부 죽는 패턴에서는 v0.13의 보수적 single slot이 현행
    // 공격 배치보다 낫다 — 이 릴리즈 퇴행의 복구가 admission 실험의 동기다.
    trajectories
      .filter((trajectory) => trajectory.phaseCount === 16)
      .forEach((trajectory) => {
        for (const kernelPreset of KERNEL_PRESETS) {
          const previousRelease = resultFor(trajectory.id, kernelPreset, 'v013-single-slot');
          const production = resultFor(trajectory.id, kernelPreset, 'production');
          expect(production.totalNetSavedTokens).toBeLessThan(previousRelease.totalNetSavedTokens);
        }
      });
  });

  it('재등장 phase 뒤의 고정 B가 클수록 full recall의 production 대비 이득이 커진다', () => {
    const fourPhaseTrajectories = trajectories
      .filter((trajectory) => trajectory.phaseCount === 4)
      .sort((left, right) => left.fixedTailTokens - right.fixedTailTokens);
    const improvements = fourPhaseTrajectories.map((trajectory) => {
      const production = resultFor(trajectory.id, 'calibrated', 'production');
      const fullRecall = resultFor(trajectory.id, 'calibrated', 'oracle-shield-phase-recall');
      return efficiency(fullRecall) - efficiency(production);
    });

    expect(improvements[1]).toBeGreaterThan(improvements[0]);
    expect(improvements[2]).toBeGreaterThan(improvements[1]);
  });
});
