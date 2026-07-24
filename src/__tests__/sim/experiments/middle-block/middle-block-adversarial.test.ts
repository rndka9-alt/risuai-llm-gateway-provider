import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createCacheHitSimulator, type CacheHitSimulatorPreset } from '../../cache-hit-simulators';
import {
  createAdversarialTrajectories,
  type AdversarialScenario,
} from './middle-block-adversarial';
import { MIDDLE_BLOCK_POLICY_FACTORIES } from './middle-block-anchor-experiment';
import {
  createNoCachePolicy,
  createProductionCachePolicy,
  type ReplayCachePolicy,
} from '../../cache-strategies';
import { createV013SingleSlotCachePolicy } from '../../cache-strategies/v013';
import { replayScenario, type ReplayResult } from '../../replay';

const CACHE_HIT_SIMULATOR_PRESETS = [
  'calibrated',
  'pessimistic',
] satisfies readonly CacheHitSimulatorPreset[];

const ORACLE_POLICY_NAMES = [
  'oracle-shield',
  'oracle-shield-phase-recall',
  'oracle-recurrence-admitted',
  'oracle-ttl-recurrence-admitted',
  'oracle-wallclock-recurrence-admitted',
] as const;

interface PolicyFactory {
  create: () => ReplayCachePolicy;
  name: ReplayCachePolicy['name'];
}

const POLICY_FACTORIES: readonly PolicyFactory[] = [
  // 이전 릴리즈(v0.13) 실배포 정책 기준선 — 적대 패턴에서 릴리즈 간 퇴행 여부 확인용.
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

const scenarios = createAdversarialTrajectories();
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
  cacheHitSimulatorName: CacheHitSimulatorPreset,
  policyName: string,
): ReplayResult {
  const result = results.find(
    (candidate) =>
      candidate.scenarioId === scenarioId &&
      candidate.cacheHitSimulatorName === cacheHitSimulatorName &&
      candidate.policyName === policyName,
  );
  if (result === undefined) {
    throw new Error(`Missing result for ${scenarioId}/${cacheHitSimulatorName}/${policyName}.`);
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
  return CACHE_HIT_SIMULATOR_PRESETS.map((cacheHitSimulatorName) =>
    formatTable(
      `Middle-block adversarial — ${cacheHitSimulatorName} net/input · read · write`,
      ['scenario', 'policy', 'net/input', 'read', 'write'],
      scenarios.flatMap((scenario) =>
        POLICY_FACTORIES.map((factory) => {
          const result = resultFor(scenario.id, cacheHitSimulatorName, factory.name);
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
    for (const cacheHitSimulatorPreset of CACHE_HIT_SIMULATOR_PRESETS) {
      for (const factory of POLICY_FACTORIES) {
        pluginStorage.clear();
        stubPluginStorage();
        results.push(
          await replayScenario({
            cacheHitSimulator: createCacheHitSimulator(cacheHitSimulatorPreset),
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

describe('middle-block adversarial scenarios', () => {
  it('모든 scenario × cache hit simulator × policy 결과를 수집한다', () => {
    expect(results).toHaveLength(
      scenarios.length * CACHE_HIT_SIMULATOR_PRESETS.length * POLICY_FACTORIES.length,
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
    const declaredTrajectories: readonly AdversarialScenario[] = scenarios;
    declaredTrajectories.forEach((scenario) => {
      expect(scenario.attackSurface.length).toBeGreaterThan(0);
    });
  });

  it('double-tap: 재등장 증거 기반 admission이 shield는 물론 production보다 뒤진다', () => {
    for (const cacheHitSimulatorPreset of CACHE_HIT_SIMULATOR_PRESETS) {
      const production = resultFor('adv-double-tap', cacheHitSimulatorPreset, 'production');
      const shield = resultFor('adv-double-tap', cacheHitSimulatorPreset, 'oracle-shield');
      const fullRecall = resultFor(
        'adv-double-tap',
        cacheHitSimulatorPreset,
        'oracle-shield-phase-recall',
      );
      const ttlAware = resultFor(
        'adv-double-tap',
        cacheHitSimulatorPreset,
        'oracle-ttl-recurrence-admitted',
      );

      // 두 번째 관측 = 마지막 등장이라 admitted write는 전부 죽고, 정작
      // 다음 턴에 확실히 읽혔을 첫 관측 frontier는 보류된다. 증거를 기다리지
      // 않는 full recall이 오히려 dwell 히트를 전부 챙긴다.
      expect(ttlAware.totalNetSavedTokens).toBeLessThan(shield.totalNetSavedTokens);
      expect(ttlAware.totalNetSavedTokens).toBeLessThan(production.totalNetSavedTokens);
      expect(fullRecall.totalNetSavedTokens).toBeGreaterThan(production.totalNetSavedTokens);
    }
  });

  it('unique-head: 단독 message hash phase identity가 over-admit으로 최악에 수렴한다', () => {
    for (const cacheHitSimulatorPreset of CACHE_HIT_SIMULATOR_PRESETS) {
      const production = resultFor('adv-unique-head', cacheHitSimulatorPreset, 'production');
      const shield = resultFor('adv-unique-head', cacheHitSimulatorPreset, 'oracle-shield');
      const ttlAware = resultFor(
        'adv-unique-head',
        cacheHitSimulatorPreset,
        'oracle-ttl-recurrence-admitted',
      );

      // 전체 prefix가 한 번도 반복되지 않는데 X 재등장만 보고 admit한다.
      // cumulative prefix 기반 bank + 백오프를 가진 production은 참여 자체를
      // 거부해 0에 머문다.
      expect(production.totalReadTokens).toBe(0);
      expect(production.totalWriteTokens).toBe(0);
      expect(ttlAware.totalNetSavedTokens).toBeLessThan(shield.totalNetSavedTokens);
      expect(ttlAware.totalNetSavedTokens).toBeLessThan(0);
    }
  });

  it('slow-clock: 요청 수 창이 TTL 초과 재등장을 걸러내지 못한다', () => {
    for (const cacheHitSimulatorPreset of CACHE_HIT_SIMULATOR_PRESETS) {
      const shield = resultFor('adv-slow-clock', cacheHitSimulatorPreset, 'oracle-shield');
      const noWindow = resultFor(
        'adv-slow-clock',
        cacheHitSimulatorPreset,
        'oracle-recurrence-admitted',
      );
      const ttlAware = resultFor(
        'adv-slow-clock',
        cacheHitSimulatorPreset,
        'oracle-ttl-recurrence-admitted',
      );

      // 거리 4 ≤ 14창이라 창이 아무것도 거르지 않는다(무창 정책과 동일).
      // 주장된 shield-only 후퇴는 일어나지 않는다.
      expect(ttlAware.totalNetSavedTokens).toBeCloseTo(noWindow.totalNetSavedTokens);
      expect(ttlAware.totalNetSavedTokens).toBeLessThan(shield.totalNetSavedTokens);
    }
  });

  it('fast-clock: 요청 수 창이 TTL 안에 살아있는 재등장 히트를 포기한다', () => {
    for (const cacheHitSimulatorPreset of CACHE_HIT_SIMULATOR_PRESETS) {
      const shield = resultFor('adv-fast-clock', cacheHitSimulatorPreset, 'oracle-shield');
      const fullRecall = resultFor(
        'adv-fast-clock',
        cacheHitSimulatorPreset,
        'oracle-shield-phase-recall',
      );
      const ttlAware = resultFor(
        'adv-fast-clock',
        cacheHitSimulatorPreset,
        'oracle-ttl-recurrence-admitted',
      );

      // 거리 16 > 14창이라 admission이 전부 거부돼 shield로 붕괴하지만,
      // 실제 재등장 간격은 24분 < TTL이라 깊은 히트가 실재한다(full recall 우위).
      expect(ttlAware.totalNetSavedTokens).toBeCloseTo(shield.totalNetSavedTokens);
      expect(fullRecall.totalNetSavedTokens).toBeGreaterThan(shield.totalNetSavedTokens);
    }
  });

  it('보완판(wallclock): unique-head와 slow-clock에서 shield로 정확히 후퇴한다', () => {
    // cumulative prefix identity가 unique-head의 over-admit을, wall-clock 창이
    // slow-clock의 TTL 초과 admit을 각각 막아 안전 바닥(shield)에 안착한다.
    for (const cacheHitSimulatorPreset of CACHE_HIT_SIMULATOR_PRESETS) {
      for (const scenarioId of ['adv-unique-head', 'adv-slow-clock']) {
        const shield = resultFor(scenarioId, cacheHitSimulatorPreset, 'oracle-shield');
        const wallClock = resultFor(
          scenarioId,
          cacheHitSimulatorPreset,
          'oracle-wallclock-recurrence-admitted',
        );
        expect(wallClock.totalNetSavedTokens).toBeCloseTo(shield.totalNetSavedTokens);
      }
    }
  });

  it('보완판(wallclock): 긴 빠른 세션에서 요청 수 창이 포기한 깊은 히트를 회수한다', () => {
    // 주기 24분 < TTL이므로 admit이 정답. 요청 수 창(14)은 거리 16을 영원히
    // 거부해 shield에 갇히고, wall-clock 창은 학습비 회수 구간(96요청)에서
    // production까지 넘어선다.
    for (const cacheHitSimulatorPreset of CACHE_HIT_SIMULATOR_PRESETS) {
      const requestCountWindow = resultFor(
        'adv-fast-clock-long',
        cacheHitSimulatorPreset,
        'oracle-ttl-recurrence-admitted',
      );
      const wallClock = resultFor(
        'adv-fast-clock-long',
        cacheHitSimulatorPreset,
        'oracle-wallclock-recurrence-admitted',
      );
      const production = resultFor('adv-fast-clock-long', cacheHitSimulatorPreset, 'production');
      expect(wallClock.totalNetSavedTokens).toBeGreaterThan(
        requestCountWindow.totalNetSavedTokens * 3,
      );
      expect(wallClock.totalNetSavedTokens).toBeGreaterThan(production.totalNetSavedTokens);
    }
  });

  it('dual-rotator: 단일 phase 블록 가정이 구조 diff 기반 production에 크게 뒤진다', () => {
    for (const cacheHitSimulatorPreset of CACHE_HIT_SIMULATOR_PRESETS) {
      const production = resultFor('adv-dual-rotator', cacheHitSimulatorPreset, 'production');
      const shield = resultFor('adv-dual-rotator', cacheHitSimulatorPreset, 'oracle-shield');
      const ttlAware = resultFor(
        'adv-dual-rotator',
        cacheHitSimulatorPreset,
        'oracle-ttl-recurrence-admitted',
      );

      // X1 주기(2)만 보고 admit하지만 깊은 앵커의 실제 prefix 주기는 LCM=6.
      // 경계를 내용으로 추적하는 production diff가 joint 경계를 정확히 잡는다.
      expect(ttlAware.totalNetSavedTokens).toBeLessThan(shield.totalNetSavedTokens);
      expect(production.totalNetSavedTokens).toBeGreaterThan(ttlAware.totalNetSavedTokens * 4);
    }
  });
});
