import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createFakeGatewayKernel, type FakeGatewayKernelPreset } from '../../cache-hit-simulators';
import {
  createAdversarialV2Trajectories,
  type AdversarialV2Scenario,
} from './middle-block-adversarial-v2';
import { MIDDLE_BLOCK_POLICY_FACTORIES } from './middle-block-anchor-experiment';
import {
  createNoCachePolicy,
  createProductionCachePolicy,
  type ReplayCachePolicy,
} from '../../cache-strategies';
import { createV013SingleSlotCachePolicy } from '../../cache-strategies/v013';
import { replayScenario, type ReplayResult } from '../../replay';

const KERNEL_PRESETS = ['calibrated', 'pessimistic'] satisfies readonly FakeGatewayKernelPreset[];

const ORACLE_POLICY_NAMES = [
  'oracle-shield',
  'oracle-ttl-recurrence-admitted',
  'oracle-wallclock-recurrence-admitted',
] as const;

interface PolicyFactory {
  create: () => ReplayCachePolicy;
  name: ReplayCachePolicy['name'];
}

const POLICY_FACTORIES: readonly PolicyFactory[] = [
  { create: createV013SingleSlotCachePolicy, name: 'v013-single-slot' },
  { create: createProductionCachePolicy, name: 'production' },
  ...ORACLE_POLICY_NAMES.map((oraclePolicyName) => {
    const factory = MIDDLE_BLOCK_POLICY_FACTORIES.find(
      (candidate) => candidate.name === oraclePolicyName,
    );
    if (factory === undefined) {
      throw new Error(`Missing middle-block oracle policy factory: ${oraclePolicyName}`);
    }
    return factory;
  }),
  { create: createNoCachePolicy, name: 'no-cache' },
];

const scenarios = createAdversarialV2Trajectories();
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
  scenarioId: string,
  kernelName: FakeGatewayKernelPreset,
  policyName: string,
): ReplayResult {
  const result = results.find(
    (candidate) =>
      candidate.scenarioId === scenarioId &&
      candidate.kernelName === kernelName &&
      candidate.policyName === policyName,
  );
  if (result === undefined) {
    throw new Error(`Missing result for ${scenarioId}/${kernelName}/${policyName}.`);
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

function formatScoreboard(): string {
  return KERNEL_PRESETS.map((kernelName) =>
    formatTable(
      `Middle-block adversarial v2 — ${kernelName} net/input · read · write`,
      ['scenario', 'policy', 'net/input', 'read', 'write'],
      scenarios.flatMap((scenario) =>
        POLICY_FACTORIES.map((factory) => {
          const result = resultFor(scenario.id, kernelName, factory.name);
          return [
            scenario.id,
            factory.name,
            `${efficiency(result).toFixed(2)}%`,
            result.totalReadTokens.toFixed(0),
            result.totalWriteTokens.toFixed(0),
          ];
        }),
      ),
    ),
  ).join('\n\n');
}

beforeAll(async () => {
  stubPluginStorage();
  for (const scenario of scenarios) {
    for (const kernelPreset of KERNEL_PRESETS) {
      for (const factory of POLICY_FACTORIES) {
        pluginStorage.clear();
        stubPluginStorage();
        results.push(
          await replayScenario({
            kernel: createFakeGatewayKernel(kernelPreset),
            policy: factory.create(),
            scenario,
          }),
        );
      }
    }
  }
  console.log(formatScoreboard());
}, 300_000);

afterAll(() => {
  vi.unstubAllGlobals();
});

describe('middle-block adversarial v2 scenarios', () => {
  it('모든 scenario × kernel × policy 결과를 수집한다', () => {
    expect(results).toHaveLength(
      scenarios.length * KERNEL_PRESETS.length * POLICY_FACTORIES.length,
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

  it('적대적 scenario마다 attack surface가 선언돼 있다', () => {
    const declaredTrajectories: readonly AdversarialV2Scenario[] = scenarios;
    declaredTrajectories.forEach((scenario) => {
      expect(scenario.attackSurface.length).toBeGreaterThan(0);
    });
  });

  it('boundary jitter: 27분 write를 29분 뒤 읽지 못해 shield와 실배포 정책보다 뒤진다', () => {
    for (const kernelPreset of KERNEL_PRESETS) {
      const v013SingleSlot = resultFor(
        'adv2-boundary-jitter-bait',
        kernelPreset,
        'v013-single-slot',
      );
      const production = resultFor('adv2-boundary-jitter-bait', kernelPreset, 'production');
      const shield = resultFor('adv2-boundary-jitter-bait', kernelPreset, 'oracle-shield');
      const wallClock = resultFor(
        'adv2-boundary-jitter-bait',
        kernelPreset,
        'oracle-wallclock-recurrence-admitted',
      );

      // 29분은 서버 TTL 안이지만 admission 창 밖이라 marker를 회수한다.
      // 그 결과 27분 관측에서 쓴 깊은 prefix는 read를 한 번도 늘리지 못하고
      // write만 남긴다.
      expect(wallClock.totalReadTokens).toBe(shield.totalReadTokens);
      expect(wallClock.totalWriteTokens).toBeGreaterThan(shield.totalWriteTokens);
      expect(wallClock.totalNetSavedTokens).toBeLessThan(shield.totalNetSavedTokens);
      expect(wallClock.totalNetSavedTokens).toBeLessThan(production.totalNetSavedTokens);
      expect(wallClock.totalNetSavedTokens).toBeLessThan(v013SingleSlot.totalNetSavedTokens);
    }
  });

  it('28분 refresh chain: 포함 경계에서는 frontier 연쇄를 유지해 실배포 기준선도 넘는다', () => {
    for (const kernelPreset of KERNEL_PRESETS) {
      const production = resultFor('adv2-boundary-refresh-chain', kernelPreset, 'production');
      const shield = resultFor('adv2-boundary-refresh-chain', kernelPreset, 'oracle-shield');
      const wallClock = resultFor(
        'adv2-boundary-refresh-chain',
        kernelPreset,
        'oracle-wallclock-recurrence-admitted',
      );

      // 직전 frontier가 매번 28분 된 새 엔트리로 이어지므로 TTL refresh 여부와
      // 무관하게 경계 안 재등장의 학습비를 회수한다.
      expect(wallClock.totalNetSavedTokens).toBeGreaterThan(shield.totalNetSavedTokens);
      expect(wallClock.totalNetSavedTokens).toBeGreaterThan(production.totalNetSavedTokens);
    }
  });

  it('dwell→tail churn: 과거 recurrence 증거를 철회하지 못해 shield 아래로 무너진다', () => {
    for (const kernelPreset of KERNEL_PRESETS) {
      const production = resultFor('adv2-dwell-to-tail-churn', kernelPreset, 'production');
      const shield = resultFor('adv2-dwell-to-tail-churn', kernelPreset, 'oracle-shield');
      const wallClock = resultFor(
        'adv2-dwell-to-tail-churn',
        kernelPreset,
        'oracle-wallclock-recurrence-admitted',
      );

      // 초반 stable tail의 히트가 phase admission을 영구적으로 열고, identity
      // 밖 tail이 churn으로 바뀐 뒤에도 매 요청 전체 prefix를 다시 쓴다.
      expect(wallClock.totalNetSavedTokens).toBeLessThan(shield.totalNetSavedTokens);
      expect(wallClock.totalNetSavedTokens).toBeLessThan(production.totalNetSavedTokens);
      expect(wallClock.totalWriteTokens).toBeGreaterThan(production.totalWriteTokens * 20);
    }
  });

  it('저빈도 tail 교체: 8요청 dwell의 read가 교체 write를 상쇄해 공격을 버틴다', () => {
    for (const kernelPreset of KERNEL_PRESETS) {
      const production = resultFor(
        'adv2-low-frequency-tail-replacement',
        kernelPreset,
        'production',
      );
      const shield = resultFor(
        'adv2-low-frequency-tail-replacement',
        kernelPreset,
        'oracle-shield',
      );
      const wallClock = resultFor(
        'adv2-low-frequency-tail-replacement',
        kernelPreset,
        'oracle-wallclock-recurrence-admitted',
      );

      expect(wallClock.totalNetSavedTokens).toBeGreaterThan(shield.totalNetSavedTokens);
      expect(wallClock.totalNetSavedTokens).toBeGreaterThan(production.totalNetSavedTokens);
    }
  });

  it('history rebase: 범위 안에 복귀한 stale frontier가 다른 lineage를 가리키며 퇴행한다', () => {
    for (const kernelPreset of KERNEL_PRESETS) {
      const v013SingleSlot = resultFor('adv2-history-rebase', kernelPreset, 'v013-single-slot');
      const production = resultFor('adv2-history-rebase', kernelPreset, 'production');
      const shield = resultFor('adv2-history-rebase', kernelPreset, 'oracle-shield');
      const wallClock = resultFor(
        'adv2-history-rebase',
        kernelPreset,
        'oracle-wallclock-recurrence-admitted',
      );

      // index 16은 직전 긴 lineage의 frontier였다. 축소 요청에서는 숨겨지지만,
      // 더 긴 독립 lineage에서 다시 유효 범위가 돼 current 24와 함께 마킹된다.
      expect(wallClock.logs[3].anchorIndexes).toEqual([0, 2, 16, 24]);
      expect(wallClock.totalNetSavedTokens).toBeLessThan(shield.totalNetSavedTokens);
      expect(wallClock.totalNetSavedTokens).toBeLessThan(production.totalNetSavedTokens);
      expect(wallClock.totalNetSavedTokens).toBeLessThan(v013SingleSlot.totalNetSavedTokens);
    }
  });

  it('혼합 phase 수명: one-off 상태는 shield에 격리되고 hot phase recall은 유지된다', () => {
    for (const kernelPreset of KERNEL_PRESETS) {
      const production = resultFor('adv2-mixed-phase-lifetimes', kernelPreset, 'production');
      const shield = resultFor('adv2-mixed-phase-lifetimes', kernelPreset, 'oracle-shield');
      const wallClock = resultFor(
        'adv2-mixed-phase-lifetimes',
        kernelPreset,
        'oracle-wallclock-recurrence-admitted',
      );

      // 짝수 번째 요청의 phase는 모두 일회성이므로 fixed head 하나만 wire에
      // 남아야 한다. 이 관측들이 hot phase의 별도 recurrence 상태를 닫지 않는다.
      wallClock.logs
        .filter((log) => log.requestIndex % 2 === 1)
        .forEach((log) => expect(log.wireMarkerCount).toBe(1));
      expect(wallClock.totalNetSavedTokens).toBeGreaterThan(shield.totalNetSavedTokens);
      expect(wallClock.totalNetSavedTokens).toBeGreaterThan(production.totalNetSavedTokens);
    }
  });
});
