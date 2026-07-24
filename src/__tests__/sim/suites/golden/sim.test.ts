import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ReplayResult } from '../../core/replay';
import { formatScoreboard } from '../../reporting/format-scoreboard';
import { registerAdaptivePolicyTransitions } from './adaptive-policy-transition-suite';
import { expectGoldenDirection } from './golden-direction-assertions';
import {
  cleanupReplayGlobals,
  expectCommonInvariants,
  initializeReplayResults,
  KERNEL_PRESETS,
  POLICY_NAMES,
  type PolicyName,
  POSITIVE_TRAJECTORY_IDS,
  replayResults,
  requireReplayResult,
  requireTrajectoryById,
  trajectories,
} from './sim-context';
import { registerValidatedAdmissionPolicyComparisons } from './validated-admission-suite';

beforeAll(initializeReplayResults, 60_000);

afterAll(cleanupReplayGlobals);

describe('deterministic replay golden trajectories', () => {
  it('실존·정책 비용 케이스 27개를 고정한다', () => {
    expect(trajectories).toHaveLength(27);
  });

  it('실사용 context·응답 규모를 유지한다', () => {
    const noCacheResults = replayResults.filter(
      (result) => result.kernelName === 'calibrated' && result.policyName === 'no-cache',
    );
    // 22는 eviction을 만들 최소 요청 수를 유지하면서 질량을 낮추려고 의도적으로
    // 35k 프로필을 쓴다. 나머지 분포의 기존 범위·대표성은 별도로 고정한다.
    const representativeResults = noCacheResults.filter(
      (result) => result.trajectoryId !== '22-cross-churn-eviction',
    );
    const representativeInputTokens = representativeResults.flatMap((result) =>
      result.logs.map((log) => log.inputTokens),
    );
    expect(Math.min(...representativeInputTokens)).toBeGreaterThanOrEqual(50_000);
    expect(Math.max(...representativeInputTokens)).toBeLessThanOrEqual(160_000);
    const typicalInputCount = representativeInputTokens.filter(
      (tokens) => tokens >= 80_000 && tokens <= 120_000,
    ).length;
    expect(typicalInputCount / representativeInputTokens.length).toBeGreaterThanOrEqual(0.6);
    const crossChurn = noCacheResults.find(
      (result) => result.trajectoryId === '22-cross-churn-eviction',
    );
    if (crossChurn === undefined) throw new Error('Missing cross-churn no-cache replay.');
    expect(crossChurn.totalInputTokens).toBeLessThan(2_000_000);

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

  it('교차 churn은 16칸에서 얕은 그룹을 밀어내고 TTL과 성숙 방 상태를 분리한다', () => {
    const trajectory = requireTrajectoryById('22-cross-churn-eviction');
    const bank = requireReplayResult(trajectory, 'calibrated', 'production');
    const singleSlot = requireReplayResult(trajectory, 'calibrated', 'v013-single-slot');
    const requireLog = (result: ReplayResult, requestIndex: number) => {
      const log = result.logs[requestIndex];
      if (log === undefined) throw new Error(`Missing cross-churn request ${requestIndex}.`);
      return log;
    };
    const churnRequestIndexes = [10, 11, 13, 14, 16, 17, 19, 20, 22, 23, 25, 26, 28, 29, 31];
    const activeRoomRequestIndexes = [12, 15, 18, 21, 24, 27, 30, 32];
    const churnLogs = churnRequestIndexes.map((requestIndex) => requireLog(bank, requestIndex));
    const activeRoomLogs = activeRoomRequestIndexes.map((requestIndex) =>
      requireLog(bank, requestIndex),
    );
    const expiredActiveReturn = requireLog(bank, 24);
    const bankLongIdleReturn = bank.logs.at(-1);
    const singleSlotLongIdleReturn = singleSlot.logs.at(-1);
    if (bankLongIdleReturn === undefined || singleSlotLongIdleReturn === undefined) {
      throw new Error('Cross-churn replay request layout is incomplete.');
    }

    expect(trajectory.requests).toHaveLength(34);
    expect(new Set(trajectory.requests.map((entry) => JSON.stringify(entry.messages))).size).toBe(
      trajectory.requests.length,
    );
    expect(trajectory.requests.some((entry) => entry.elapsedMinutes > 30)).toBe(true);
    expect(
      trajectory.requests.some((entry) => entry.elapsedMinutes > 0 && entry.elapsedMinutes < 30),
    ).toBe(true);
    expect(churnLogs).toHaveLength(15);
    expect(churnLogs.every((log) => log.policyMarkerCount === 0)).toBe(true);
    expect(activeRoomLogs).toHaveLength(8);
    expect(activeRoomLogs.every((log) => log.policyMarkerCount > 0)).toBe(true);
    expect(activeRoomLogs.some((log) => log.readTokens > 0)).toBe(true);
    expect(expiredActiveReturn.readTokens).toBe(0);
    expect(expiredActiveReturn.writeTokens).toBeGreaterThan(0);
    expect(bankLongIdleReturn.policyMarkerCount).toBeGreaterThan(0);
    expect(bankLongIdleReturn.readTokens).toBe(0);
    expect(bankLongIdleReturn.writeTokens).toBeGreaterThan(0);
    expect(singleSlotLongIdleReturn.policyMarkerCount).toBe(0);
  });

  it('scoreboard 총계를 멀티룸 4종과 나머지 단일방으로 분리한다', () => {
    const scoreboard = formatScoreboard(replayResults);

    expect(scoreboard).toContain('multi-room (15/16/21/22)');
    expect(scoreboard).toContain('single-room (remaining 23)');
    expect(scoreboard).toContain('all (27)');
  });
});

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

registerValidatedAdmissionPolicyComparisons();

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

registerAdaptivePolicyTransitions();
