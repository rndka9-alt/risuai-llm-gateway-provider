import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createFakeGatewayKernel } from './fake-gateway';
import { createGoldenTrajectories } from './golden-trajectories';
import { createAppendSweepTrajectories } from './longrun-patterns';
import { createAuthoredTrajectories } from './neutral-authored';
import { createProceduralTrajectories } from './neutral-procedural';
import { createProductionCachePolicy } from './policy';
import { replayTrajectory } from './replay';

// 현재 구현(frontier 보호 축출 규칙) 기준 production의 케이스별 수치를 JSON으로
// 남긴다. longrun-evictfix.test.ts의 구 규칙 JSON과 diff하면 보호 규칙의 효과를
// 케이스 단위로 확인할 수 있다.

const OUTPUT_PATH = join(tmpdir(), 'llm-gateway-evictfix-current.json');

export const SWEEP_TURN_COUNTS = [8, 15, 25, 40, 60] as const;

describe('evictfix baseline dump', () => {
  it('현재 구현 production의 케이스별 결과를 JSON으로 남긴다', async () => {
    const pluginStorage = new Map<string, string>();
    vi.stubGlobal('risuai', {
      pluginStorage: {
        getItem: async (key: string) => pluginStorage.get(key) ?? null,
        setItem: async (key: string, value: string) => {
          pluginStorage.set(key, value);
        },
      },
    });

    const suites = [
      ['golden-25', createGoldenTrajectories()],
      ['neutral-authored', createAuthoredTrajectories().map((entry) => entry.trajectory)],
      ['neutral-procedural', createProceduralTrajectories()],
      ['append-sweep', createAppendSweepTrajectories(SWEEP_TURN_COUNTS)],
    ] as const;

    const scenarios: {
      id: string;
      inputTokens: number;
      netSavedTokens: number;
      suite: string;
    }[] = [];
    for (const [suiteName, trajectories] of suites) {
      for (const trajectory of trajectories) {
        pluginStorage.clear();
        const result = await replayTrajectory({
          kernel: createFakeGatewayKernel('calibrated'),
          policy: createProductionCachePolicy(),
          trajectory,
        });
        scenarios.push({
          id: trajectory.id,
          inputTokens: result.totalInputTokens,
          netSavedTokens: result.totalNetSavedTokens,
          suite: suiteName,
        });
      }
    }
    writeFileSync(OUTPUT_PATH, JSON.stringify({ scenarios }, null, 2));
    expect(scenarios.length).toBeGreaterThan(0);

    // 경제성 회귀 가드: frontier 보호 규칙이 깨지면 장기 append 효율이
    // 20%대로 추락한다 (구 규칙 실측 21.2%, 보호 후 86.7%).
    const longestAppendSweep = scenarios.find((scenario) => scenario.id === 'sweep-append-t60');
    if (longestAppendSweep === undefined) {
      throw new Error('append-sweep 60턴 시나리오가 덤프에 존재해야 한다.');
    }
    expect(
      longestAppendSweep.netSavedTokens / longestAppendSweep.inputTokens,
    ).toBeGreaterThanOrEqual(0.8);
    vi.unstubAllGlobals();
  }, 300_000);
});
