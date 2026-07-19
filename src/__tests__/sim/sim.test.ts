import type { LlmMessage } from 'llm-io';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CACHE_READ_SAVING_RATE, CACHE_WRITE_PREMIUM_RATE } from '../../ledger';
import { createFakeGatewayKernel, type FakeGatewayKernelPreset } from './fake-gateway';
import { createGoldenTrajectories } from './golden-trajectories';
import {
  createAdaptiveTwoStrikeCachePolicy,
  createAdaptiveTwoStrikeRerollAwareCachePolicy,
  createFirstTurnSafeCachePolicy,
  createLegacyProductionCachePolicy,
  createNoCachePolicy,
  createProductionCachePolicy,
  createSelectiveHardCapCachePolicy,
  createValidatedAllCachePolicy,
  type ReplayCachePolicy,
} from './policy';
import {
  formatScoreboard,
  replayTrajectory,
  type GoldenTrajectory,
  type ReplayResult,
} from './replay';

const KERNEL_PRESETS = [
  'calibrated',
  'pessimistic',
  'optimistic',
] satisfies readonly FakeGatewayKernelPreset[];
const trajectories = createGoldenTrajectories();
const pluginStorage = new Map<string, string>();
const replayResults: ReplayResult[] = [];
const POLICY_FACTORIES: readonly (() => ReplayCachePolicy)[] = [
  createLegacyProductionCachePolicy,
  createValidatedAllCachePolicy,
  createSelectiveHardCapCachePolicy,
  createProductionCachePolicy,
  createAdaptiveTwoStrikeCachePolicy,
  createAdaptiveTwoStrikeRerollAwareCachePolicy,
  createFirstTurnSafeCachePolicy,
  createNoCachePolicy,
];
const POLICY_NAMES = [
  'legacy-production',
  'validated-all',
  'selective-hard-cap',
  'production',
  'adaptive-2strike',
  'adaptive-2strike-reroll-aware',
  'first-turn-safe',
  'no-cache',
] as const;
type PolicyName = (typeof POLICY_NAMES)[number];

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

function requireReplayResult(
  trajectory: GoldenTrajectory,
  kernelName: FakeGatewayKernelPreset,
  policyName: PolicyName,
): ReplayResult {
  const result = replayResults.find(
    (candidate) =>
      candidate.trajectoryId === trajectory.id &&
      candidate.kernelName === kernelName &&
      candidate.policyName === policyName,
  );
  if (result === undefined) {
    throw new Error(`Missing replay result for ${trajectory.id}/${kernelName}/${policyName}.`);
  }
  return result;
}

function expectCommonInvariants(result: ReplayResult): void {
  expect(result.logs.length).toBeGreaterThan(0);
  result.logs.forEach((log) => {
    expect(log.readTokens + log.writeTokens).toBeLessThanOrEqual(log.inputTokens);
    expect(log.wireMarkerCount).toBeLessThanOrEqual(4);
    expect(log.policyMarkerCount).toBeLessThanOrEqual(4);
    expect(log.policyMarkerRoles).not.toContain('assistant');
    expect(log.wireMarkerRoles).not.toContain('assistant');
    expect(log.wireMarkerCount).toBe(log.policyMarkerCount);
    expect(log.markerPrefixTokens).toHaveLength(log.wireMarkerCount);
    expect(log.promptCacheKey.length).toBeLessThanOrEqual(64);

    const serializedBody = JSON.stringify(log.requestBody);
    if (log.policyMarkerCount === 0) {
      expect(serializedBody).not.toContain('prompt_cache_breakpoint');
      expect(log.readTokens).toBe(0);
      expect(log.writeTokens).toBe(0);
    } else {
      expect(serializedBody).toContain('prompt_cache_breakpoint');
    }
    expect(log.netSavedTokens).toBeCloseTo(
      log.readTokens * CACHE_READ_SAVING_RATE - log.writeTokens * CACHE_WRITE_PREMIUM_RATE,
    );
  });

  expect(result.totalInputTokens).toBe(
    result.logs.reduce((total, log) => total + log.inputTokens, 0),
  );
  expect(result.totalReadTokens).toBe(
    result.logs.reduce((total, log) => total + log.readTokens, 0),
  );
  expect(result.totalWriteTokens).toBe(
    result.logs.reduce((total, log) => total + log.writeTokens, 0),
  );
  expect(result.totalNetSavedTokens).toBeCloseTo(
    result.totalReadTokens * CACHE_READ_SAVING_RATE -
      result.totalWriteTokens * CACHE_WRITE_PREMIUM_RATE,
  );
}

function expectGoldenDirection(trajectory: GoldenTrajectory): void {
  const calibrated = requireReplayResult(trajectory, 'calibrated', 'legacy-production');
  const pessimistic = requireReplayResult(trajectory, 'pessimistic', 'legacy-production');
  const optimistic = requireReplayResult(trajectory, 'optimistic', 'legacy-production');

  if (trajectory.id === '01-append') {
    expect(calibrated.totalNetSavedTokens).toBeGreaterThan(0);
    expect(calibrated.totalReadTokens).toBeGreaterThan(calibrated.totalWriteTokens);
    return;
  }
  if (trajectory.id === '02-cbs-trap') {
    expect(calibrated.totalReadTokens).toBe(0);
    expect(calibrated.totalNetSavedTokens).toBeLessThanOrEqual(0);
    expect(Math.abs(calibrated.totalNetSavedTokens) / calibrated.totalInputTokens).toBeGreaterThan(
      0.2,
    );
    return;
  }
  if (trajectory.id === '03-reverse-depth') {
    expect(calibrated.totalReadTokens).toBeGreaterThan(0);
    expect(calibrated.totalWriteTokens).toBeGreaterThan(0);
    expect(calibrated.totalNetSavedTokens).toBeGreaterThan(0);
    return;
  }
  if (trajectory.id === '04-reroll') {
    expect(calibrated.totalReadTokens).toBeGreaterThan(0);
    expect(calibrated.totalNetSavedTokens).toBeGreaterThan(0);
    return;
  }
  if (trajectory.id === '05-lore-toggle') {
    expect(calibrated.totalReadTokens).toBeGreaterThan(calibrated.totalWriteTokens);
    expect(calibrated.totalNetSavedTokens).toBeGreaterThan(0);
    return;
  }
  if (trajectory.id === '06-context-trim') {
    expect(calibrated.totalReadTokens).toBeGreaterThan(0);
    expect(calibrated.totalNetSavedTokens).toBeGreaterThan(0);
    return;
  }
  if (trajectory.id === '07-hypa-summary') {
    expect(calibrated.totalReadTokens).toBeGreaterThan(0);
    expect(calibrated.totalWriteTokens).toBeGreaterThan(0);
    expect(calibrated.logs.slice(-4).every((log) => log.writeTokens > 0)).toBe(true);
    expect(calibrated.totalNetSavedTokens).toBeGreaterThan(0);
    return;
  }
  if (trajectory.id === '08-lua-post-edit') {
    expect(calibrated.totalReadTokens).toBeGreaterThan(0);
    expect(calibrated.totalNetSavedTokens).toBeGreaterThan(0);
    return;
  }
  if (trajectory.id === '09-room-switch') {
    expect(calibrated.totalReadTokens).toBe(0);
    expect(calibrated.totalNetSavedTokens).toBeLessThan(0);
    expect(calibrated.logs.map((log) => log.consecutiveEpochResets)).toEqual([0, 1, 0]);
    // 과거엔 optimistic(partial-prefix)이 shared-global 부분 히트로 손실을
    // 줄였지만, 매칭이 exact로 실측 확정된(probe-cache-partial.mjs) 뒤로는
    // room switch 손실이 TTL 가정과 무관한 매칭 계약의 구조적 손실임을 고정한다.
    expect(optimistic.totalNetSavedTokens).toBe(calibrated.totalNetSavedTokens);
    return;
  }
  if (trajectory.id === '10-ttl-gap') {
    expect(pessimistic.totalReadTokens).toBe(0);
    expect(pessimistic.totalNetSavedTokens).toBeLessThan(0);
    expect(optimistic.totalReadTokens).toBeGreaterThan(0);
    expect(optimistic.totalNetSavedTokens).toBeGreaterThan(0);
    expect(optimistic.totalNetSavedTokens).toBeGreaterThan(pessimistic.totalNetSavedTokens);
    return;
  }
  if (trajectory.id === '11-churn-then-stable' || trajectory.id === '12-churn-oscillating') {
    expect(calibrated.totalReadTokens).toBeGreaterThan(0);
    expect(calibrated.totalWriteTokens).toBeGreaterThan(0);
    expect(calibrated.totalNetSavedTokens).toBeGreaterThan(0);
    return;
  }
  if (trajectory.id.startsWith('13-manual-summary-additive-')) {
    // 현실 크기에서는 summary 앞의 얕은 hit가 뒤쪽 대규모 write를 항상
    // 상각하지 못한다. 큰 history·mixed mask의 적자를 그대로 노출한다.
    expect(calibrated.totalReadTokens).toBeGreaterThan(0);
    if (
      [
        '13-manual-summary-additive-typical-110k',
        '13-manual-summary-additive-ceiling-150k',
        '13-manual-summary-additive-typical-110k-mixed',
        '13-manual-summary-additive-hist-32t',
      ].includes(trajectory.id)
    ) {
      expect(calibrated.totalNetSavedTokens).toBeLessThan(0);
      return;
    }
    expect(calibrated.totalNetSavedTokens).toBeGreaterThan(0);
    return;
  }
  if (trajectory.id === '14-trim-saturation') {
    // 3k~6k 응답 30개가 든 포화 창에서는 얕은 head read만으로 rolling
    // history의 대규모 write를 상각하지 못한다.
    expect(calibrated.totalReadTokens).toBeGreaterThan(0);
    expect(calibrated.totalNetSavedTokens).toBeLessThan(0);
    return;
  }
  if (trajectory.id === '15-multi-room-roundrobin') {
    // 방문 내 append 히트가 방 전환 cold write를 상각해 현 정책으로도 흑자다.
    // 단, 단일 anchor state 한계로 TTL 내 방 복귀의 기존 entry 히트는 회수하지
    // 못한 값 — per-chat state 분리 개선의 상한 근거로 남긴다.
    expect(calibrated.totalReadTokens).toBeGreaterThan(0);
    expect(calibrated.totalNetSavedTokens).toBeGreaterThan(0);
    return;
  }
  if (trajectory.id === '16-group-speaker-rotation') {
    // 응답자별 description 교체(#1)가 요청마다 프리픽스 초입을 갈아, 공통
    // 프리픽스가 sub-1024 main뿐인 요청이 대부분이다 — 현 정책에선
    // no-cache(0)가 더 나은 케이스로 남는다.
    expect(calibrated.totalNetSavedTokens).toBeLessThan(0);
    return;
  }
  if (trajectory.id === '17-mid-history-edits') {
    // 과거 개서(수정·롤백 재진행·이어쓰기·깊은 삭제)는 이벤트당 손실이
    // 유계라 append 구간의 히트가 상각한다.
    expect(calibrated.totalReadTokens).toBeGreaterThan(0);
    expect(calibrated.totalNetSavedTokens).toBeGreaterThan(0);
    return;
  }
  if (trajectory.id === '18-suppressed-frontier-branch-boundary') {
    const monitoredRequest = calibrated.logs[2];
    const bypassRequest = calibrated.logs[3];

    // 세 번째 요청은 두 번째 구조적 사망으로 latest frontier 마킹을 억제한다.
    expect(monitoredRequest.anchorIndexes).toEqual([0, 3]);
    expect(monitoredRequest.policyMarkerCount).toBe(1);
    // 네 번째 요청은 latest frontier(3)를 계속 억제하지만, 새 branch boundary(1)가
    // 중간 앵커로 들어와 마킹되면서 실환경과 같은 대규모 cache write를 만든다.
    expect(bypassRequest.anchorIndexes).toEqual([0, 2, 4]);
    expect(bypassRequest.policyMarkerCount).toBe(2);
    expect(bypassRequest.readTokens).toBeGreaterThan(0);
    expect(bypassRequest.writeTokens).toBeGreaterThan(50_000);
    expect(bypassRequest.netSavedTokens).toBeLessThan(0);
    expect(calibrated.totalNetSavedTokens).toBeLessThan(0);
    return;
  }
  if (trajectory.id === '19-large-stable-prefix-admission') {
    expect(calibrated.totalWriteTokens).toBeGreaterThan(16_384);
    expect(calibrated.totalReadTokens).toBeGreaterThan(calibrated.totalWriteTokens);
    expect(calibrated.totalNetSavedTokens).toBeGreaterThan(0);
    return;
  }
  if (trajectory.id === '20-large-prefix-invalidated-after-admission') {
    expect(calibrated.totalWriteTokens).toBeGreaterThan(16_384);
    expect(calibrated.totalReadTokens).toBe(calibrated.totalWriteTokens);
    expect(calibrated.totalNetSavedTokens).toBeGreaterThan(0);
    return;
  }
  throw new Error(`No direction assertion is defined for ${trajectory.id}.`);
}

beforeAll(async () => {
  stubPluginStorage();
  for (const trajectory of trajectories) {
    for (const kernelPreset of KERNEL_PRESETS) {
      for (const createPolicy of POLICY_FACTORIES) {
        // planner 상태와 wrapper 클로저를 정책·커널 실행마다 함께 격리한다.
        pluginStorage.clear();
        replayResults.push(
          await replayTrajectory({
            kernel: createFakeGatewayKernel(kernelPreset),
            policy: createPolicy(),
            trajectory,
          }),
        );
      }
    }
  }
  console.log(formatScoreboard(replayResults));
}, 60_000);

afterAll(() => {
  vi.unstubAllGlobals();
});

describe('deterministic replay golden trajectories', () => {
  it('실존·정책 비용 케이스 25개를 고정한다', () => {
    expect(trajectories).toHaveLength(25);
  });

  it('실사용 context·응답 규모를 유지한다', () => {
    const inputTokens = replayResults
      .filter((result) => result.kernelName === 'calibrated' && result.policyName === 'no-cache')
      .flatMap((result) => result.logs.map((log) => log.inputTokens));
    expect(Math.min(...inputTokens)).toBeGreaterThanOrEqual(50_000);
    expect(Math.max(...inputTokens)).toBeLessThanOrEqual(160_000);
    const typicalInputCount = inputTokens.filter(
      (tokens) => tokens >= 80_000 && tokens <= 120_000,
    ).length;
    expect(typicalInputCount / inputTokens.length).toBeGreaterThanOrEqual(0.6);

    const assistantTokenSizes = new Set<number>();
    trajectories.forEach((trajectory) => {
      trajectory.requests.forEach((trajectoryRequest) => {
        trajectoryRequest.messages.forEach((message) => {
          if (message.role !== 'assistant') return;
          const characters = message.content.reduce(
            (total, part) => total + (part.type === 'text' ? part.text.length : 0),
            0,
          );
          const tokens = Math.ceil(characters / 4);
          expect(tokens).toBeGreaterThanOrEqual(3_000);
          expect(tokens).toBeLessThanOrEqual(32_000);
          assistantTokenSizes.add(tokens);
        });
      });
    });
    expect([...assistantTokenSizes].sort((left, right) => left - right)).toEqual([
      3_000, 6_000, 12_000, 20_000, 32_000,
    ]);
  });

  describe.each(trajectories)('$id $label', (trajectory) => {
    it.each(KERNEL_PRESETS)('%s kernel의 회계·와이어 불변식을 지킨다', (kernelPreset) => {
      POLICY_NAMES.forEach((policyName) => {
        expectCommonInvariants(requireReplayResult(trajectory, kernelPreset, policyName));
      });
      const noCache = requireReplayResult(trajectory, kernelPreset, 'no-cache');
      expect(noCache.totalReadTokens).toBe(0);
      expect(noCache.totalWriteTokens).toBe(0);
      expect(noCache.totalNetSavedTokens).toBe(0);
    });

    it('golden 방향성 기대를 지킨다', () => {
      expectGoldenDirection(trajectory);
    });
  });
});

const POSITIVE_TRAJECTORY_IDS = [
  '01-append',
  '03-reverse-depth',
  '04-reroll',
  '05-lore-toggle',
  '06-context-trim',
  '07-hypa-summary',
  '08-lua-post-edit',
] as const;

function requireTrajectoryById(trajectoryId: string): GoldenTrajectory {
  const trajectory = trajectories.find((candidate) => candidate.id === trajectoryId);
  if (trajectory === undefined) {
    throw new Error(`Missing golden trajectory ${trajectoryId}.`);
  }
  return trajectory;
}

describe('adaptive policy golden comparisons', () => {
  it('2-strike 계열은 양수 골든에서 production 대비 회귀하지 않는다', () => {
    for (const trajectoryId of POSITIVE_TRAJECTORY_IDS) {
      const trajectory = requireTrajectoryById(trajectoryId);
      const production = requireReplayResult(trajectory, 'calibrated', 'legacy-production');
      for (const policyName of [
        'adaptive-2strike',
        'adaptive-2strike-reroll-aware',
      ] satisfies readonly PolicyName[]) {
        const adaptive = requireReplayResult(trajectory, 'calibrated', policyName);
        expect(adaptive.totalNetSavedTokens).toBeGreaterThanOrEqual(production.totalNetSavedTokens);
      }
    }
  });

  it('2-strike는 상습 휘발 assistant 꼬리에서 production 이상을 유지한다', () => {
    const trajectory = requireTrajectoryById('08-lua-post-edit');
    const production = requireReplayResult(trajectory, 'calibrated', 'legacy-production');

    for (const policyName of [
      'adaptive-2strike',
      'adaptive-2strike-reroll-aware',
    ] satisfies readonly PolicyName[]) {
      expect(
        requireReplayResult(trajectory, 'calibrated', policyName).totalNetSavedTokens,
      ).toBeGreaterThanOrEqual(production.totalNetSavedTokens);
    }
  });

  it('02의 대규모 휘발 write는 순수 2-strike만 일부 차단한다', () => {
    const trajectory = requireTrajectoryById('02-cbs-trap');
    const production = requireReplayResult(trajectory, 'calibrated', 'legacy-production');

    expect(
      requireReplayResult(trajectory, 'calibrated', 'adaptive-2strike').totalNetSavedTokens,
    ).toBeGreaterThan(production.totalNetSavedTokens);
    expect(
      requireReplayResult(trajectory, 'calibrated', 'adaptive-2strike-reroll-aware')
        .totalNetSavedTokens,
    ).toBe(production.totalNetSavedTokens);
  });

  it('승격된 production은 manual-summary 전 변형에서 2-strike 후보들과 동률이다', () => {
    // 위치 판별형 2-strike가 production에 내장되어, 과거 후보 정책들이 내던
    // 회수분이 기본 동작이 됐다 — 후보 레이어의 추가 억제는 no-op이다.
    for (const scaleId of [
      'floor-80k',
      'typical-110k',
      'ceiling-150k',
      'typical-110k-mixed',
      'hist-2t',
      'hist-32t',
    ]) {
      const trajectory = requireTrajectoryById(`13-manual-summary-additive-${scaleId}`);
      const production = requireReplayResult(trajectory, 'calibrated', 'legacy-production');
      for (const policyName of [
        'adaptive-2strike',
        'adaptive-2strike-reroll-aware',
      ] satisfies readonly PolicyName[]) {
        const adaptive = requireReplayResult(trajectory, 'calibrated', policyName);
        expect(adaptive.totalNetSavedTokens).toBe(production.totalNetSavedTokens);
      }
    }
  });

  it('mid-history 개서에서 reroll-aware는 production을 유지하고 순수 2-strike는 회귀한다', () => {
    // in-place 수정·이어쓰기는 메시지 수가 같아 reroll-like로 분류된다. 순수
    // 2-strike는 이를 frontier 사망으로 세어 억제 비용을 내지만, reroll-aware는
    // 무시해 production과 같다 — 실사용 개서 패턴에서 판별의 존재 이유를 고정한다.
    const trajectory = requireTrajectoryById('17-mid-history-edits');
    const production = requireReplayResult(trajectory, 'calibrated', 'legacy-production');
    const adaptive = requireReplayResult(trajectory, 'calibrated', 'adaptive-2strike');
    const rerollAware = requireReplayResult(
      trajectory,
      'calibrated',
      'adaptive-2strike-reroll-aware',
    );

    expect(adaptive.totalNetSavedTokens).toBeLessThan(production.totalNetSavedTokens);
    expect(rerollAware.totalNetSavedTokens).toBe(production.totalNetSavedTokens);
  });

  it('포화 트림 구제는 production에 내장되어 2-strike 후보들과 동률이다', () => {
    // 과거 reroll-aware의 "같은 개수 = 리롤" 미탐은 위치 판별(시프트 감지)로
    // 해소됐다 — 개수 유지 트림도 스트라이크로 잡혀 세 정책이 같은 점수를 낸다.
    const trajectory = requireTrajectoryById('14-trim-saturation');
    const production = requireReplayResult(trajectory, 'calibrated', 'legacy-production');
    const adaptive = requireReplayResult(trajectory, 'calibrated', 'adaptive-2strike');
    const rerollAware = requireReplayResult(
      trajectory,
      'calibrated',
      'adaptive-2strike-reroll-aware',
    );

    expect(adaptive.totalNetSavedTokens).toBe(production.totalNetSavedTokens);
    expect(rerollAware.totalNetSavedTokens).toBe(production.totalNetSavedTokens);
  });

  it('2-strike는 room switch의 same-index frontier write 손실을 일부 회수한다', () => {
    const trajectory = requireTrajectoryById('09-room-switch');
    const production = requireReplayResult(trajectory, 'calibrated', 'legacy-production');
    const adaptive = requireReplayResult(trajectory, 'calibrated', 'adaptive-2strike');
    const rerollAware = requireReplayResult(
      trajectory,
      'calibrated',
      'adaptive-2strike-reroll-aware',
    );

    expect(adaptive.totalNetSavedTokens).toBeGreaterThan(production.totalNetSavedTokens);
    expect(rerollAware.totalNetSavedTokens).toBe(production.totalNetSavedTokens);
  });

  it('first-turn-safe는 room switch 첫 턴의 회수 전 write 손실을 줄인다', () => {
    const trajectory = requireTrajectoryById('09-room-switch');
    const production = requireReplayResult(trajectory, 'calibrated', 'legacy-production');
    const firstTurnSafe = requireReplayResult(trajectory, 'calibrated', 'first-turn-safe');

    expect(firstTurnSafe.totalNetSavedTokens).toBeGreaterThan(production.totalNetSavedTokens);
  });

  it('first-turn-safe가 양수 골든 7종 모두에서 10% 초과 회귀한 결과를 노출한다', () => {
    const regressedTrajectoryIds = POSITIVE_TRAJECTORY_IDS.filter((trajectoryId) => {
      const trajectory = requireTrajectoryById(trajectoryId);
      const production = requireReplayResult(trajectory, 'calibrated', 'legacy-production');
      const firstTurnSafe = requireReplayResult(trajectory, 'calibrated', 'first-turn-safe');
      return firstTurnSafe.totalNetSavedTokens < production.totalNetSavedTokens * 0.9;
    });

    expect(regressedTrajectoryIds).toEqual(POSITIVE_TRAJECTORY_IDS);
  });
});

describe('validated admission policy comparisons', () => {
  it('실측 branch boundary 우회 손실을 대규모 write 없이 얕은 cold write로 제한한다', () => {
    const trajectory = requireTrajectoryById('18-suppressed-frontier-branch-boundary');
    const legacy = requireReplayResult(trajectory, 'calibrated', 'legacy-production');
    const validated = requireReplayResult(trajectory, 'calibrated', 'validated-all');
    const legacyBypassRequest = legacy.logs[3];
    const validatedBypassRequest = validated.logs[3];

    expect(legacyBypassRequest.writeTokens).toBeGreaterThan(50_000);
    expect(validatedBypassRequest.writeTokens).toBeLessThan(2_000);
    expect(validated.totalWriteTokens).toBeLessThan(2_000);
    expect(validated.totalNetSavedTokens).toBeGreaterThan(legacy.totalNetSavedTokens);
  });

  it('영구 hard cap은 현실 크기의 기존 양수 골든도 admission하지 못한다', () => {
    for (const trajectoryId of POSITIVE_TRAJECTORY_IDS) {
      const trajectory = requireTrajectoryById(trajectoryId);
      const legacy = requireReplayResult(trajectory, 'calibrated', 'legacy-production');
      const validated = requireReplayResult(trajectory, 'calibrated', 'validated-all');

      expect(validated.totalNetSavedTokens).toBe(0);
      expect(validated.totalNetSavedTokens).toBeLessThan(legacy.totalNetSavedTokens);
      expect(validated.totalReadTokens).toBe(0);
      expect(validated.totalWriteTokens).toBe(0);
    }
  });

  it('영구 hard cap은 write와 함께 기존 순절감도 대부분 포기한다', () => {
    const calibrated = replayResults.filter(
      (result) =>
        result.kernelName === 'calibrated' &&
        result.trajectoryId !== '19-large-stable-prefix-admission' &&
        result.trajectoryId !== '20-large-prefix-invalidated-after-admission',
    );
    const totalsFor = (policyName: PolicyName) => {
      const policyResults = calibrated.filter((result) => result.policyName === policyName);
      return {
        netSavedTokens: policyResults.reduce(
          (total, result) => total + result.totalNetSavedTokens,
          0,
        ),
        writeTokens: policyResults.reduce((total, result) => total + result.totalWriteTokens, 0),
      };
    };
    const legacy = totalsFor('legacy-production');
    const validated = totalsFor('validated-all');

    expect(validated.writeTokens).toBeLessThan(legacy.writeTokens * 0.02);
    expect(validated.netSavedTokens).toBeLessThan(legacy.netSavedTokens * 0.05);
    expect(validated.netSavedTokens).toBeGreaterThan(0);
    expect(validated.netSavedTokens).toBeLessThan(legacy.netSavedTokens);
  });

  it('선택적 검증은 전면 검증보다 read를 회복하고 hard cap보다 순절감을 높인다', () => {
    const calibrated = replayResults.filter((result) => result.kernelName === 'calibrated');
    const totalsFor = (policyName: PolicyName) => {
      const policyResults = calibrated.filter((result) => result.policyName === policyName);
      return {
        netSavedTokens: policyResults.reduce(
          (total, result) => total + result.totalNetSavedTokens,
          0,
        ),
        readTokens: policyResults.reduce((total, result) => total + result.totalReadTokens, 0),
        writeTokens: policyResults.reduce((total, result) => total + result.totalWriteTokens, 0),
      };
    };
    const legacy = totalsFor('legacy-production');
    const validated = totalsFor('validated-all');
    const hardCapped = totalsFor('selective-hard-cap');
    const selective = totalsFor('production');

    expect(selective.netSavedTokens).toBeGreaterThan(validated.netSavedTokens);
    expect(selective.netSavedTokens).toBeGreaterThan(hardCapped.netSavedTokens);
    expect(selective.readTokens).toBeGreaterThan(validated.readTokens);
    expect(selective.readTokens).toBeGreaterThan(hardCapped.readTokens);
    expect(selective.writeTokens).toBeGreaterThan(hardCapped.writeTokens);
    expect(selective.writeTokens).toBeLessThan(legacy.writeTokens * 0.35);
    expect(selective.netSavedTokens).toBeLessThan(legacy.netSavedTokens);
  });

  it('선택적 검증의 분기 우회 방어는 기존과 전면 검증 사이의 손실로 수렴한다', () => {
    const trajectory = requireTrajectoryById('18-suppressed-frontier-branch-boundary');
    const legacy = requireReplayResult(trajectory, 'calibrated', 'legacy-production');
    const validated = requireReplayResult(trajectory, 'calibrated', 'validated-all');
    const selective = requireReplayResult(trajectory, 'calibrated', 'production');

    expect(selective.totalNetSavedTokens).toBeGreaterThan(legacy.totalNetSavedTokens);
    expect(selective.totalNetSavedTokens).toBe(validated.totalNetSavedTokens);
    expect(selective.totalWriteTokens).toBeLessThan(legacy.totalWriteTokens);
    expect(selective.totalWriteTokens).toBe(validated.totalWriteTokens);
  });

  it('안전한 일반 흐름도 대규모 첫 prefix의 warm-up 비용을 내되 흑자를 유지한다', () => {
    for (const trajectoryId of [
      '01-append',
      '04-reroll',
      '05-lore-toggle',
      '06-context-trim',
      '08-lua-post-edit',
    ]) {
      const trajectory = requireTrajectoryById(trajectoryId);
      const legacy = requireReplayResult(trajectory, 'calibrated', 'legacy-production');
      const selective = requireReplayResult(trajectory, 'calibrated', 'production');

      expect(selective.totalNetSavedTokens).toBeGreaterThan(0);
      expect(selective.totalNetSavedTokens).toBeLessThan(legacy.totalNetSavedTokens);
    }
  });

  it('16k 초과 안정 prefix는 두 번 생존한 뒤 write하고 다음 요청에서 회수한다', () => {
    const trajectory = requireTrajectoryById('19-large-stable-prefix-admission');
    const hardCapped = requireReplayResult(trajectory, 'calibrated', 'selective-hard-cap');
    const selective = requireReplayResult(trajectory, 'calibrated', 'production');

    expect(hardCapped.logs.map((log) => log.policyMarkerCount)).toEqual([0, 0, 0, 0]);
    expect(hardCapped.totalNetSavedTokens).toBe(0);
    expect(selective.logs.map((log) => log.policyMarkerCount)).toEqual([0, 0, 1, 1]);
    expect(selective.logs[2].writeTokens).toBeGreaterThan(16_384);
    expect(selective.logs[2].netSavedTokens).toBeLessThan(0);
    expect(selective.logs[3].readTokens).toBe(selective.logs[2].writeTokens);
    expect(selective.logs[3].netSavedTokens).toBeGreaterThan(0);
    expect(selective.totalWriteTokens).toBeGreaterThan(16_384);
    expect(selective.totalReadTokens).toBe(selective.totalWriteTokens);
    expect(selective.totalNetSavedTokens).toBeGreaterThan(0);
  });

  it('16k 초과 prefix가 admission 직후 깨지면 cold write를 회수하지 못한다', () => {
    const trajectory = requireTrajectoryById('20-large-prefix-invalidated-after-admission');
    const hardCapped = requireReplayResult(trajectory, 'calibrated', 'selective-hard-cap');
    const selective = requireReplayResult(trajectory, 'calibrated', 'production');

    expect(hardCapped.logs.map((log) => log.policyMarkerCount)).toEqual([0, 0, 0, 0]);
    expect(hardCapped.totalNetSavedTokens).toBe(0);
    expect(selective.logs.map((log) => log.policyMarkerCount)).toEqual([0, 0, 1, 0]);
    expect(selective.logs[2].writeTokens).toBeGreaterThan(16_384);
    expect(selective.logs[2].netSavedTokens).toBeLessThan(0);
    expect(selective.logs[3].readTokens).toBe(0);
    expect(selective.totalReadTokens).toBe(0);
    expect(selective.totalWriteTokens).toBe(selective.logs[2].writeTokens);
    expect(selective.totalNetSavedTokens).toBeLessThan(0);
  });

  it('hard cap 해제는 현실 크기의 일반 흐름에서도 admission 차이를 만든다', () => {
    const changedTrajectoryIds = trajectories
      .filter((trajectory) => {
        const hardCapped = requireReplayResult(trajectory, 'calibrated', 'selective-hard-cap');
        const selective = requireReplayResult(trajectory, 'calibrated', 'production');
        return hardCapped.totalNetSavedTokens !== selective.totalNetSavedTokens;
      })
      .map((trajectory) => trajectory.id);

    expect(changedTrajectoryIds).toContain('01-append');
    expect(changedTrajectoryIds).toContain('19-large-stable-prefix-admission');
    expect(changedTrajectoryIds).toContain('20-large-prefix-invalidated-after-admission');
    expect(changedTrajectoryIds).not.toContain('02-cbs-trap');
    expect(changedTrajectoryIds).not.toContain('14-trim-saturation');
  });
});

function requestIndexesWithScoreDifference(
  reference: ReplayResult,
  candidate: ReplayResult,
): number[] {
  if (reference.logs.length !== candidate.logs.length) {
    throw new Error('Compared replay results must have the same request count.');
  }

  const requestIndexes: number[] = [];
  reference.logs.forEach((referenceLog, requestIndex) => {
    const candidateLog = candidate.logs[requestIndex];
    if (candidateLog === undefined) {
      throw new Error(`Missing candidate request log ${requestIndex}.`);
    }
    if (referenceLog.netSavedTokens !== candidateLog.netSavedTokens) {
      requestIndexes.push(requestIndex);
    }
  });
  return requestIndexes;
}

describe('adaptive policy cost golden comparisons', () => {
  it.each(KERNEL_PRESETS)('%s kernel에서도 지연 write 비용 방향이 유지된다', (kernelPreset) => {
    for (const trajectoryId of ['11-churn-then-stable', '12-churn-oscillating']) {
      const trajectory = requireTrajectoryById(trajectoryId);
      const production = requireReplayResult(trajectory, kernelPreset, 'legacy-production');
      const adaptive = requireReplayResult(trajectory, kernelPreset, 'adaptive-2strike');
      const rerollAware = requireReplayResult(
        trajectory,
        kernelPreset,
        'adaptive-2strike-reroll-aware',
      );

      // 커널 가정이 달라도 안정화 직전 write를 미룬 adaptive만 다음 턴의
      // frontier read를 잃고, monitor를 켜지 않은 reroll-aware는 production과 같다.
      expect(adaptive.totalNetSavedTokens).toBeLessThan(production.totalNetSavedTokens);
      expect(rerollAware.totalNetSavedTokens).toBe(production.totalNetSavedTokens);
    }
  });

  it.each([
    ['11-churn-then-stable', [4, 5]],
    ['12-churn-oscillating', [3, 4, 6, 7, 9, 10]],
  ] satisfies readonly (readonly [string, readonly number[]])[])(
    '%s은 억제 턴과 직후 안정 턴에서 production보다 손해를 본다',
    (trajectoryId, expectedDifferenceIndexes) => {
      const trajectory = requireTrajectoryById(trajectoryId);
      const production = requireReplayResult(trajectory, 'calibrated', 'legacy-production');
      const adaptive = requireReplayResult(trajectory, 'calibrated', 'adaptive-2strike');
      const rerollAware = requireReplayResult(
        trajectory,
        'calibrated',
        'adaptive-2strike-reroll-aware',
      );

      // 두 번째 사망에서 건너뛴 frontier write가 다음 안정 턴의 hit를
      // 지연시키므로, write premium은 같아도 해당 세그먼트 read 절감이 한 번 사라진다.
      expect(adaptive.totalNetSavedTokens).toBeLessThan(production.totalNetSavedTokens);
      expect(requestIndexesWithScoreDifference(production, adaptive)).toEqual(
        expectedDifferenceIndexes,
      );

      // 동일 길이의 두 번째 churn은 reroll-like 변경으로 분류되어 strike를
      // 누적하지 않으므로 reroll-aware 변형은 이 monitor 비용을 내지 않는다.
      expect(rerollAware.totalNetSavedTokens).toBe(production.totalNetSavedTokens);
    },
  );

  it('진동 손실은 안정 턴마다 초기화되어 3회 cycle에 선형으로 누적된다', () => {
    const stableTrajectory = requireTrajectoryById('11-churn-then-stable');
    const oscillatingTrajectory = requireTrajectoryById('12-churn-oscillating');
    const stableProduction = requireReplayResult(
      stableTrajectory,
      'calibrated',
      'legacy-production',
    );
    const stableAdaptive = requireReplayResult(stableTrajectory, 'calibrated', 'adaptive-2strike');
    const oscillatingProduction = requireReplayResult(
      oscillatingTrajectory,
      'calibrated',
      'legacy-production',
    );
    const oscillatingAdaptive = requireReplayResult(
      oscillatingTrajectory,
      'calibrated',
      'adaptive-2strike',
    );
    const singleCyclePenalty =
      stableProduction.totalNetSavedTokens - stableAdaptive.totalNetSavedTokens;
    const oscillatingPenalty =
      oscillatingProduction.totalNetSavedTokens - oscillatingAdaptive.totalNetSavedTokens;

    // 안정 확인이 monitor를 해제하므로 손실은 cycle당 지연 read 1회로 유계이며,
    // 같은 크기의 세 cycle에서는 폭주하지 않고 대략 3배가 되어야 한다.
    expect(oscillatingPenalty).toBeGreaterThan(singleCyclePenalty * 2.9);
    expect(oscillatingPenalty).toBeLessThan(singleCyclePenalty * 3.1);
  });
});

function makePolicyTestMessage(role: LlmMessage['role'], text: string): LlmMessage {
  return { role, content: [{ type: 'text', text }] };
}

function breakpointIndexes(messages: readonly LlmMessage[]): number[] {
  const indexes: number[] = [];
  messages.forEach((message, messageIndex) => {
    if (
      message.content.some((part) => part.type === 'text' && part.cacheBreakpoint !== undefined)
    ) {
      indexes.push(messageIndex);
    }
  });
  return indexes;
}

describe('adaptive policy transitions', () => {
  it('2회 사망 뒤 새 frontier를 한 턴 억제하고 생존한 다음 턴에 자연히 마킹한다', async () => {
    pluginStorage.clear();
    const policy = createAdaptiveTwoStrikeCachePolicy();
    const stablePrefix = makePolicyTestMessage('system', 'S'.repeat(6_000));
    const stableSuffix = makePolicyTestMessage('user', 'stable suffix');
    const first = [stablePrefix, makePolicyTestMessage('system', 'volatile A'), stableSuffix];
    const second = [
      stablePrefix,
      makePolicyTestMessage('system', 'volatile B'),
      makePolicyTestMessage('system', 'growth B'),
      stableSuffix,
    ];
    const third = [
      stablePrefix,
      makePolicyTestMessage('system', 'volatile C'),
      makePolicyTestMessage('system', 'growth B'),
      makePolicyTestMessage('system', 'new frontier C'),
      stableSuffix,
    ];

    await policy.apply(first);
    await policy.apply(second);
    const monitored = await policy.apply(third);
    const confirmed = await policy.apply(third);

    expect(monitored.anchorIndexes).toEqual([0, 3]);
    expect(breakpointIndexes(monitored.messages)).toEqual([0]);
    expect(breakpointIndexes(confirmed.messages)).toEqual([0, 3]);
  });

  it('같은 인덱스의 fingerprint가 바뀐 frontier도 새 frontier로 억제한다', async () => {
    pluginStorage.clear();
    const policy = createAdaptiveTwoStrikeCachePolicy();
    const sharedGlobal = makePolicyTestMessage('system', 'S'.repeat(5_500));
    const sharedInput = makePolicyTestMessage('user', 'shared input');
    const firstRoom = [
      makePolicyTestMessage('system', 'A'.repeat(7_000)),
      makePolicyTestMessage('user', 'room A input'),
    ];
    const secondRoom = [
      sharedGlobal,
      makePolicyTestMessage('system', 'B'.repeat(3_000)),
      sharedInput,
    ];
    const thirdRoom = [
      sharedGlobal,
      makePolicyTestMessage('system', 'C'.repeat(3_000)),
      sharedInput,
    ];

    await policy.apply(firstRoom);
    await policy.apply(secondRoom);
    const monitored = await policy.apply(thirdRoom);
    const confirmed = await policy.apply(thirdRoom);

    expect(monitored.anchorIndexes).toEqual([0, 1]);
    expect(breakpointIndexes(monitored.messages)).toEqual([0]);
    expect(breakpointIndexes(confirmed.messages)).toEqual([0, 1]);
  });

  it('reroll-aware 변형은 동일 길이 꼬리 변경을 strike로 누적하지 않는다', async () => {
    const stablePrefix = makePolicyTestMessage('system', 'S'.repeat(6_000));
    const stableSuffix = makePolicyTestMessage('user', 'stable suffix');
    const first = [stablePrefix, makePolicyTestMessage('system', 'reroll A'), stableSuffix];
    const reroll = [stablePrefix, makePolicyTestMessage('system', 'reroll B'), stableSuffix];
    const growth = [
      stablePrefix,
      makePolicyTestMessage('system', 'changed after reroll'),
      makePolicyTestMessage('system', 'new frontier'),
      stableSuffix,
    ];

    pluginStorage.clear();
    const adaptive = createAdaptiveTwoStrikeCachePolicy();
    await adaptive.apply(first);
    await adaptive.apply(reroll);
    const adaptiveGrowth = await adaptive.apply(growth);

    pluginStorage.clear();
    const rerollAware = createAdaptiveTwoStrikeRerollAwareCachePolicy();
    await rerollAware.apply(first);
    await rerollAware.apply(reroll);
    const awareGrowth = await rerollAware.apply(growth);

    expect(breakpointIndexes(adaptiveGrowth.messages)).toEqual([0]);
    expect(breakpointIndexes(awareGrowth.messages)).toEqual([0, 2]);
  });

  it('first-turn-safe는 새 epoch를 저장만 하고 동일한 두 번째 턴부터 마킹한다', async () => {
    pluginStorage.clear();
    const policy = createFirstTurnSafeCachePolicy();
    const messages = [
      makePolicyTestMessage('system', 'S'.repeat(6_000)),
      makePolicyTestMessage('user', 'first input'),
    ];

    const first = await policy.apply(messages);
    const second = await policy.apply(messages);

    expect(breakpointIndexes(first.messages)).toEqual([]);
    expect(breakpointIndexes(second.messages)).toEqual([0]);
  });
});
