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

// 축출 보호 실험의 대조군: 무패치(stock) production을 동일 스위트에 돌려
// 케이스별 수치를 JSON으로 남긴다. longrun-evictfix.test.ts의 fix JSON과 diff용.

const OUTPUT_PATH = join(tmpdir(), 'llm-gateway-evictfix-stock.json');

export const SWEEP_TURN_COUNTS = [8, 15, 25, 40, 60] as const;

describe('evictfix baseline dump', () => {
  it('stock production의 케이스별 결과를 JSON으로 남긴다', async () => {
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
    vi.unstubAllGlobals();
  }, 300_000);
});
