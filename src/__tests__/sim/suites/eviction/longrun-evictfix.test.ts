import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createCacheHitSimulator } from '../../cache-hit-simulators';
import { createCanonicalScenarios } from '../../scenarios';
import { createAppendSweepScenarios, createLongRunScenarios } from '../../scenarios';
import { createAuthoredNeutralScenarios } from '../../scenarios';
import { createProceduralNeutralScenarios } from '../../scenarios';
import {
  createLegacyProductionCachePolicy,
  createProductionCachePolicy,
} from '../../cache-strategies';
import { replayScenario } from '../../replay';

// 회귀 참조 실험: frontier 보호 규칙이 본체(evict-closest-anchors.ts)에 반영된 뒤,
// 보호가 없던 구 축출 규칙을 vi.mock으로 재현해 병리의 크기를 기록으로 남긴다.
// 구 규칙은 정속 append에서 (직전 frontier, 새 frontier)가 항상 최근접 쌍이 되어
// 직전 frontier를 매턴 축출했고, exact-match 계약에서 read 체인이 끊겼다
// (lr01 append 60턴 eff 21.2% vs 보호 후 86.7%).

vi.mock('../../../../cache/planner/utils/evict-closest-anchors', async () => {
  const { sumTokenEstimatesBetween } =
    await import('../../../../cache/planner/utils/sum-token-estimates-between');
  return {
    // 보호 규칙 도입 이전의 원본 구현 (커밋 8c27f1f 시점의 본체 코드와 동일).
    evictClosestAnchors: (
      anchorIndexes: readonly number[],
      fingerprints: readonly { estimatedTokens: number }[],
    ): number[] => {
      const retainedIndexes = [...anchorIndexes];
      while (retainedIndexes.length > 4) {
        let closestPairStart = 0;
        let closestPairTokenGap = Number.POSITIVE_INFINITY;
        for (let position = 0; position < retainedIndexes.length - 1; position += 1) {
          const tokenGap = sumTokenEstimatesBetween(
            fingerprints as never,
            retainedIndexes[position],
            retainedIndexes[position + 1],
          );
          if (tokenGap < closestPairTokenGap) {
            closestPairStart = position;
            closestPairTokenGap = tokenGap;
          }
        }

        const rightPosition = closestPairStart + 1;
        const positionToRemove =
          rightPosition === retainedIndexes.length - 1 ? closestPairStart : rightPosition;
        retainedIndexes.splice(positionToRemove, 1);
      }
      return retainedIndexes;
    },
  };
});

describe('anchor eviction frontier-protection experiment', () => {
  it('구 축출 규칙의 패턴별 eff%를 출력한다', async () => {
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
    for (const cacheHitSimulatorPreset of ['calibrated', 'pessimistic'] as const) {
      const totals = new Map<string, { input: number; net: number }>();
      for (const scenario of createLongRunScenarios()) {
        const cells: string[] = [];
        for (const [name, createPolicy] of [
          ['legacy+oldevict', createLegacyProductionCachePolicy],
          ['production+oldevict', createProductionCachePolicy],
        ] as const) {
          pluginStorage.clear();
          const result = await replayScenario({
            cacheHitSimulator: createCacheHitSimulator(cacheHitSimulatorPreset),
            policy: createPolicy(),
            scenario,
          });
          const efficiency = (result.totalNetSavedTokens / result.totalInputTokens) * 100;
          cells.push(`${name}=${efficiency.toFixed(1)}%`);
          const total = totals.get(name) ?? { input: 0, net: 0 };
          total.input += result.totalInputTokens;
          total.net += result.totalNetSavedTokens;
          totals.set(name, total);
          expect(result.logs.length).toBeGreaterThan(0);
        }
        rows.push(`[${cacheHitSimulatorPreset}] ${scenario.id}: ${cells.join(' ')}`);
      }
      for (const [name, total] of totals) {
        rows.push(
          `[${cacheHitSimulatorPreset}] TOTAL ${name}: net=${total.net.toFixed(0)} net/input=${((total.net / total.input) * 100).toFixed(2)}%`,
        );
      }
    }
    console.log(rows.join('\n'));
    vi.unstubAllGlobals();
  }, 300_000);

  it('구 축출 규칙의 혼합·단기 스위트 총계를 출력한다', async () => {
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
      ['canonical-27', createCanonicalScenarios()],
      ['neutral-authored', createAuthoredNeutralScenarios().map((entry) => entry.scenario)],
      ['neutral-procedural', createProceduralNeutralScenarios()],
      ['append-sweep', createAppendSweepScenarios([8, 15, 25, 40, 60])],
    ] as const;
    const lines: string[] = [];
    const scenarios: {
      id: string;
      inputTokens: number;
      netSavedTokens: number;
      suite: string;
    }[] = [];
    for (const [suiteName, suiteScenarios] of suites) {
      let net = 0;
      let input = 0;
      for (const scenario of suiteScenarios) {
        pluginStorage.clear();
        const result = await replayScenario({
          cacheHitSimulator: createCacheHitSimulator('calibrated'),
          policy: createProductionCachePolicy(),
          scenario,
        });
        net += result.totalNetSavedTokens;
        input += result.totalInputTokens;
        scenarios.push({
          id: scenario.id,
          inputTokens: result.totalInputTokens,
          netSavedTokens: result.totalNetSavedTokens,
          suite: suiteName,
        });
      }
      lines.push(
        `${suiteName}: production+oldevict net=${net.toFixed(0)} (net/input ${((net / input) * 100).toFixed(2)}%)`,
      );
      expect(Number.isFinite(net)).toBe(true);
    }
    writeFileSync(
      join(tmpdir(), 'llm-gateway-evictfix-oldrule.json'),
      JSON.stringify({ scenarios }, null, 2),
    );
    console.log(lines.join('\n'));
    vi.unstubAllGlobals();
  }, 300_000);
});
