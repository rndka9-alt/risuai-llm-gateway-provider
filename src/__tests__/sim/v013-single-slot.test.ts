import { describe, expect, it } from 'vitest';
import { createFakeGatewayKernel } from './fake-gateway';
import { createGoldenTrajectories } from './golden-trajectories';
import { replayTrajectory } from './replay';
import { V013_SINGLE_SLOT_SOURCE_COMMIT } from './v013-single-slot-vendor';
import { createV013SingleSlotCachePolicy } from './v013-single-slot-policy';

interface ExpectedV013Score {
  id: string;
  totalNetSavedTokens: number;
  totalReadTokens: number;
  totalWriteTokens: number;
}

// Commit 3f3d7733 worktree 정책을 현재 27종 trajectory에서 calibrated kernel로
// replay한 값이다. 22 fixture 재설계 외 26종은 기존 실측값을 그대로 유지하며,
// 벤더 로직이나 다른 fixture가 drift하면 시나리오 단위로 잡는다.
const EXPECTED_V013_SCORES: readonly ExpectedV013Score[] = [
  {
    id: '01-append',
    totalReadTokens: 489_916,
    totalWriteTokens: 123_828,
    totalNetSavedTokens: 409_967.4,
  },
  {
    id: '02-cbs-trap',
    totalReadTokens: 0,
    totalWriteTokens: 0,
    totalNetSavedTokens: 0,
  },
  {
    id: '03-reverse-depth',
    totalReadTokens: 319_020,
    totalWriteTokens: 92_871,
    totalNetSavedTokens: 263_900.25,
  },
  {
    id: '04-reroll',
    totalReadTokens: 155_961,
    totalWriteTokens: 51_987,
    totalNetSavedTokens: 127_368.15000000001,
  },
  {
    id: '05-lore-toggle',
    totalReadTokens: 329_577,
    totalWriteTokens: 83_369,
    totalNetSavedTokens: 275_777.05,
  },
  {
    id: '06-context-trim',
    totalReadTokens: 536_288,
    totalWriteTokens: 111_138,
    totalNetSavedTokens: 454_874.7,
  },
  {
    id: '07-hypa-summary',
    totalReadTokens: 401_275,
    totalWriteTokens: 82_883,
    totalNetSavedTokens: 340_426.75,
  },
  {
    id: '08-lua-post-edit',
    totalReadTokens: 272_448,
    totalWriteTokens: 68_112,
    totalNetSavedTokens: 228_175.2,
  },
  {
    id: '09-room-switch',
    totalReadTokens: 0,
    totalWriteTokens: 0,
    totalNetSavedTokens: 0,
  },
  {
    id: '10-ttl-gap',
    totalReadTokens: 0,
    totalWriteTokens: 163_260,
    totalNetSavedTokens: -40_815,
  },
  {
    id: '11-churn-then-stable',
    totalReadTokens: 517_212,
    totalWriteTokens: 112_148,
    totalNetSavedTokens: 437_453.8,
  },
  {
    id: '12-churn-oscillating',
    totalReadTokens: 724_566,
    totalWriteTokens: 87_540,
    totalNetSavedTokens: 630_224.4,
  },
  {
    id: '13-manual-summary-additive-floor-80k',
    totalReadTokens: 333_381,
    totalWriteTokens: 66_919,
    totalNetSavedTokens: 283_313.15,
  },
  {
    id: '13-manual-summary-additive-typical-110k',
    totalReadTokens: 40_481,
    totalWriteTokens: 9_619,
    totalNetSavedTokens: 34_028.15,
  },
  {
    id: '13-manual-summary-additive-ceiling-150k',
    totalReadTokens: 57_081,
    totalWriteTokens: 13_819,
    totalNetSavedTokens: 47_918.15,
  },
  {
    id: '13-manual-summary-additive-typical-110k-mixed',
    totalReadTokens: 34_669,
    totalWriteTokens: 9_619,
    totalNetSavedTokens: 28_797.35,
  },
  {
    id: '13-manual-summary-additive-hist-2t',
    totalReadTokens: 295_481,
    totalWriteTokens: 60_619,
    totalNetSavedTokens: 250_778.15000000002,
  },
  {
    id: '13-manual-summary-additive-hist-32t',
    totalReadTokens: 40_481,
    totalWriteTokens: 9_619,
    totalNetSavedTokens: 34_028.15,
  },
  {
    id: '14-trim-saturation',
    totalReadTokens: 18_845,
    totalWriteTokens: 3_769,
    totalNetSavedTokens: 16_018.25,
  },
  {
    id: '15-multi-room-roundrobin',
    totalReadTokens: 369_622,
    totalWriteTokens: 408_578,
    totalNetSavedTokens: 230_515.30000000005,
  },
  {
    id: '16-group-speaker-rotation',
    totalReadTokens: 117_556,
    totalWriteTokens: 211_082,
    totalNetSavedTokens: 53_029.90000000001,
  },
  {
    id: '17-mid-history-edits',
    totalReadTokens: 378_997,
    totalWriteTokens: 300_744,
    totalNetSavedTokens: 265_911.3,
  },
  {
    id: '18-suppressed-frontier-branch-boundary',
    totalReadTokens: 1_505,
    totalWriteTokens: 1_505,
    totalNetSavedTokens: 978.25,
  },
  {
    id: '19-large-stable-prefix-admission',
    totalReadTokens: 160_010,
    totalWriteTokens: 80_005,
    totalNetSavedTokens: 124_007.75,
  },
  {
    id: '20-large-prefix-invalidated-after-admission',
    totalReadTokens: 80_005,
    totalWriteTokens: 80_005,
    totalNetSavedTokens: 52_003.25,
  },
  {
    id: '21-content-addressed-roundrobin',
    totalReadTokens: 0,
    totalWriteTokens: 0,
    totalNetSavedTokens: 0,
  },
  {
    id: '22-cross-churn-eviction',
    totalReadTokens: 276_780,
    totalWriteTokens: 124_596,
    totalNetSavedTokens: 217_953,
  },
];

describe('v0.13 single-slot production fidelity', () => {
  it('HEAD 3f3d7733 worktree의 calibrated 27종 read/write/net과 정확히 일치한다', async () => {
    expect(V013_SINGLE_SLOT_SOURCE_COMMIT).toBe('3f3d7733250877ef53d34ebf4a150a4f2447f159');
    const trajectories = createGoldenTrajectories();
    expect(trajectories.map((trajectory) => trajectory.id)).toEqual(
      EXPECTED_V013_SCORES.map((score) => score.id),
    );

    const actualScores: ExpectedV013Score[] = [];
    for (const trajectory of trajectories) {
      const result = await replayTrajectory({
        kernel: createFakeGatewayKernel('calibrated'),
        policy: createV013SingleSlotCachePolicy(),
        trajectory,
      });
      actualScores.push({
        id: result.trajectoryId,
        totalNetSavedTokens: result.totalNetSavedTokens,
        totalReadTokens: result.totalReadTokens,
        totalWriteTokens: result.totalWriteTokens,
      });
    }

    expect(actualScores).toEqual(EXPECTED_V013_SCORES);
    expect(
      actualScores.reduce(
        (totals, score) => ({
          totalNetSavedTokens: totals.totalNetSavedTokens + score.totalNetSavedTokens,
          totalReadTokens: totals.totalReadTokens + score.totalReadTokens,
          totalWriteTokens: totals.totalWriteTokens + score.totalWriteTokens,
        }),
        { totalNetSavedTokens: 0, totalReadTokens: 0, totalWriteTokens: 0 },
      ),
    ).toEqual({
      totalNetSavedTokens: 4_766_632.8,
      totalReadTokens: 5_951_157,
      totalWriteTokens: 2_357_634,
    });
  });
});
