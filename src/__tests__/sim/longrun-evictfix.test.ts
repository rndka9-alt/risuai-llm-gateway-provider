import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createFakeGatewayKernel } from './fake-gateway';
import { createGoldenTrajectories } from './golden-trajectories';
import { createAppendSweepTrajectories, createLongRunPatternTrajectories } from './longrun-patterns';
import { createAuthoredTrajectories } from './neutral-authored';
import { createProceduralTrajectories } from './neutral-procedural';
import { createLegacyProductionCachePolicy, createProductionCachePolicy } from './policy';
import { replayTrajectory } from './replay';

// 가설 검증 실험: 정속 append 장기 세션에서 (직전 frontier, 새 frontier)가 항상
// 최근접 쌍이 되어 직전 frontier가 매턴 축출되고, exact-match 계약에서 read 체인이
// 끊긴다(lr01 legacy 21.2%). 본체 코드는 수정하지 않고 vi.mock으로
// "마지막 두 앵커(직전 frontier 포함) 보호" 변형을 주입해 효과만 측정한다.

vi.mock('../../cache/planner/utils/evict-closest-anchors', async () => {
  const { sumTokenEstimatesBetween } = await import(
    '../../cache/planner/utils/sum-token-estimates-between'
  );
  return {
    evictClosestAnchors: (
      anchorIndexes: readonly number[],
      fingerprints: readonly { estimatedTokens: number }[],
    ): number[] => {
      const retainedIndexes = [...anchorIndexes];
      while (retainedIndexes.length > 4) {
        let positionToRemove = -1;
        let closestPairTokenGap = Number.POSITIVE_INFINITY;
        for (let position = 0; position < retainedIndexes.length - 1; position += 1) {
          const rightPosition = position + 1;
          const candidate =
            rightPosition === retainedIndexes.length - 1 ? position : rightPosition;
          // 마지막 두 앵커(최신 frontier + 직전 frontier)는 보호한다.
          if (candidate >= retainedIndexes.length - 2) continue;
          const tokenGap = sumTokenEstimatesBetween(
            fingerprints as never,
            retainedIndexes[position],
            retainedIndexes[rightPosition],
          );
          if (tokenGap < closestPairTokenGap) {
            closestPairTokenGap = tokenGap;
            positionToRemove = candidate;
          }
        }
        retainedIndexes.splice(positionToRemove === -1 ? 0 : positionToRemove, 1);
      }
      return retainedIndexes;
    },
  };
});

describe('anchor eviction frontier-protection experiment', () => {
  it('보호 변형의 패턴별 eff%를 출력한다', async () => {
    const pluginStorage = new Map<string, string>();
    vi.stubGlobal('risuai', {
      pluginStorage: {
        getItem: async (key: string) => pluginStorage.get(key) ?? null,
        setItem: async (key: string, value: string) => {
          pluginStorage.set(key, value);
        },
      },
    });

    const rows: string[] = [];
    for (const kernelPreset of ['calibrated', 'pessimistic'] as const) {
      const totals = new Map<string, { input: number; net: number }>();
      for (const trajectory of createLongRunPatternTrajectories()) {
        const cells: string[] = [];
        for (const [name, createPolicy] of [
          ['legacy+fix', createLegacyProductionCachePolicy],
          ['production+fix', createProductionCachePolicy],
        ] as const) {
          pluginStorage.clear();
          const result = await replayTrajectory({
            kernel: createFakeGatewayKernel(kernelPreset),
            policy: createPolicy(),
            trajectory,
          });
          const efficiency = (result.totalNetSavedTokens / result.totalInputTokens) * 100;
          cells.push(`${name}=${efficiency.toFixed(1)}%`);
          const total = totals.get(name) ?? { input: 0, net: 0 };
          total.input += result.totalInputTokens;
          total.net += result.totalNetSavedTokens;
          totals.set(name, total);
          expect(result.logs.length).toBeGreaterThan(0);
        }
        rows.push(`[${kernelPreset}] ${trajectory.id}: ${cells.join(' ')}`);
      }
      for (const [name, total] of totals) {
        rows.push(
          `[${kernelPreset}] TOTAL ${name}: net=${total.net.toFixed(0)} net/input=${((total.net / total.input) * 100).toFixed(2)}%`,
        );
      }
    }
    console.log(rows.join('\n'));
    vi.unstubAllGlobals();
  }, 300_000);

  it('보호 변형이 2라운드 스위트에서 회귀하지 않는지 총계를 출력한다', async () => {
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
      ['append-sweep', createAppendSweepTrajectories([8, 15, 25, 40, 60])],
    ] as const;
    const lines: string[] = [];
    const scenarios: {
      id: string;
      inputTokens: number;
      netSavedTokens: number;
      suite: string;
    }[] = [];
    for (const [suiteName, trajectories] of suites) {
      let net = 0;
      let input = 0;
      for (const trajectory of trajectories) {
        pluginStorage.clear();
        const result = await replayTrajectory({
          kernel: createFakeGatewayKernel('calibrated'),
          policy: createProductionCachePolicy(),
          trajectory,
        });
        net += result.totalNetSavedTokens;
        input += result.totalInputTokens;
        scenarios.push({
          id: trajectory.id,
          inputTokens: result.totalInputTokens,
          netSavedTokens: result.totalNetSavedTokens,
          suite: suiteName,
        });
      }
      lines.push(
        `${suiteName}: production+fix net=${net.toFixed(0)} (net/input ${((net / input) * 100).toFixed(2)}%)`,
      );
      expect(Number.isFinite(net)).toBe(true);
    }
    writeFileSync(
      join(tmpdir(), 'llm-gateway-evictfix-fix.json'),
      JSON.stringify({ scenarios }, null, 2),
    );
    console.log(lines.join('\n'));
    vi.unstubAllGlobals();
  }, 300_000);
});
