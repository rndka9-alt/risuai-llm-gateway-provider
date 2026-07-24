import { describe, expect, it } from 'vitest';
import { isMultiRoomCanonicalScenario } from '../../reporting';
import {
  type PolicyName,
  POSITIVE_SCENARIO_IDS,
  replayResults,
  requireReplayResult,
  requireScenarioById,
  scenarios,
} from './sim-context';

export function registerValidatedAdmissionPolicyComparisons(): void {
  describe('validated admission policy comparisons', () => {
    it('실측 branch boundary 우회 손실을 대규모 write 없이 얕은 cold write로 제한한다', () => {
      const scenario = requireScenarioById('18-suppressed-frontier-branch-boundary');
      const legacy = requireReplayResult(scenario, 'calibrated', 'legacy-production');
      const validated = requireReplayResult(scenario, 'calibrated', 'validated-all');
      const legacyBypassRequest = legacy.logs[3];
      const validatedBypassRequest = validated.logs[3];

      expect(legacyBypassRequest.writeTokens).toBeGreaterThan(50_000);
      expect(validatedBypassRequest.writeTokens).toBeLessThan(2_000);
      expect(validated.totalWriteTokens).toBeLessThan(2_000);
      expect(validated.totalNetSavedTokens).toBeGreaterThan(legacy.totalNetSavedTokens);
    });

    it('영구 hard cap은 현실 크기의 기존 양수 골든도 admission하지 못한다', () => {
      for (const scenarioId of POSITIVE_SCENARIO_IDS) {
        const scenario = requireScenarioById(scenarioId);
        const legacy = requireReplayResult(scenario, 'calibrated', 'legacy-production');
        const validated = requireReplayResult(scenario, 'calibrated', 'validated-all');

        expect(validated.totalNetSavedTokens).toBe(0);
        expect(validated.totalNetSavedTokens).toBeLessThan(legacy.totalNetSavedTokens);
        expect(validated.totalReadTokens).toBe(0);
        expect(validated.totalWriteTokens).toBe(0);
      }
    });

    it('영구 hard cap은 write와 함께 기존 순절감도 대부분 포기한다', () => {
      const calibrated = replayResults.filter(
        (result) =>
          result.cacheHitSimulatorName === 'calibrated' &&
          result.scenarioId !== '19-large-stable-prefix-admission' &&
          result.scenarioId !== '20-large-prefix-invalidated-after-admission',
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

    it('content-addressed 선택적 검증은 전면 검증과 단일 상태보다 순절감을 높인다', () => {
      const calibrated = replayResults.filter(
        (result) => result.cacheHitSimulatorName === 'calibrated',
      );
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
      const singleRoomLegacyWriteTokens = calibrated
        .filter(
          (result) =>
            result.policyName === 'legacy-production' &&
            !isMultiRoomCanonicalScenario(result.scenarioId),
        )
        .reduce((total, result) => total + result.totalWriteTokens, 0);
      const singleRoomSelectiveWriteTokens = calibrated
        .filter(
          (result) =>
            result.policyName === 'production' && !isMultiRoomCanonicalScenario(result.scenarioId),
        )
        .reduce((total, result) => total + result.totalWriteTokens, 0);

      expect(selective.netSavedTokens).toBeGreaterThan(validated.netSavedTokens);
      expect(selective.netSavedTokens).toBeGreaterThan(hardCapped.netSavedTokens);
      expect(selective.readTokens).toBeGreaterThan(validated.readTokens);
      expect(selective.readTokens).toBeGreaterThan(hardCapped.readTokens);
      expect(selective.writeTokens).toBeGreaterThan(hardCapped.writeTokens);
      expect(singleRoomSelectiveWriteTokens).toBeLessThan(singleRoomLegacyWriteTokens * 0.51);
      expect(selective.netSavedTokens).toBeGreaterThan(legacy.netSavedTokens);
    });

    it('한 번 생존 production은 직전 정책보다 read를 회복하면서 공격형보다 write를 억제한다', () => {
      const calibrated = replayResults.filter(
        (result) => result.cacheHitSimulatorName === 'calibrated',
      );
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
      const previous = totalsFor('production-two-survival');
      const current = totalsFor('production');
      const singleRoomLegacyWriteTokens = calibrated
        .filter(
          (result) =>
            result.policyName === 'legacy-production' &&
            !isMultiRoomCanonicalScenario(result.scenarioId),
        )
        .reduce((total, result) => total + result.totalWriteTokens, 0);
      const singleRoomCurrentWriteTokens = calibrated
        .filter(
          (result) =>
            result.policyName === 'production' && !isMultiRoomCanonicalScenario(result.scenarioId),
        )
        .reduce((total, result) => total + result.totalWriteTokens, 0);

      expect(current.netSavedTokens).toBeGreaterThan(previous.netSavedTokens);
      expect(current.netSavedTokens).toBeGreaterThan(legacy.netSavedTokens * 0.8);
      expect(current.readTokens).toBeGreaterThan(previous.readTokens);
      expect(current.writeTokens).toBeGreaterThan(previous.writeTokens);
      expect(singleRoomCurrentWriteTokens).toBeLessThan(singleRoomLegacyWriteTokens * 0.51);
    });

    it('fork 경계 admission 승계는 분기 우회의 read를 복구한다', () => {
      const scenario = requireScenarioById('18-suppressed-frontier-branch-boundary');
      const legacy = requireReplayResult(scenario, 'calibrated', 'legacy-production');
      const validated = requireReplayResult(scenario, 'calibrated', 'validated-all');
      const selective = requireReplayResult(scenario, 'calibrated', 'production');

      expect(selective.totalNetSavedTokens).toBeGreaterThan(legacy.totalNetSavedTokens);
      expect(selective.totalNetSavedTokens).toBeGreaterThan(validated.totalNetSavedTokens);
      expect(selective.totalReadTokens).toBeGreaterThan(validated.totalReadTokens);
      expect(selective.totalWriteTokens).toBeLessThan(legacy.totalWriteTokens);
    });

    it('안전한 일반 흐름도 대규모 첫 prefix의 warm-up 비용을 내되 흑자를 유지한다', () => {
      for (const scenarioId of [
        '01-append',
        '04-reroll',
        '05-lore-toggle',
        '06-context-trim',
        '08-lua-post-edit',
      ]) {
        const scenario = requireScenarioById(scenarioId);
        const legacy = requireReplayResult(scenario, 'calibrated', 'legacy-production');
        const selective = requireReplayResult(scenario, 'calibrated', 'production');

        expect(selective.totalNetSavedTokens).toBeGreaterThan(0);
        expect(selective.totalNetSavedTokens).toBeLessThan(legacy.totalNetSavedTokens);
      }
    });

    it('16k 초과 안정 prefix는 두 번 생존한 뒤 write하고 다음 요청에서 회수한다', () => {
      const scenario = requireScenarioById('19-large-stable-prefix-admission');
      const hardCapped = requireReplayResult(scenario, 'calibrated', 'selective-hard-cap');
      const previous = requireReplayResult(scenario, 'calibrated', 'production-two-survival');

      expect(hardCapped.logs.map((log) => log.policyMarkerCount)).toEqual([0, 0, 0, 0]);
      expect(hardCapped.totalNetSavedTokens).toBe(0);
      expect(previous.logs.map((log) => log.policyMarkerCount)).toEqual([0, 0, 1, 1]);
      expect(previous.logs[2].writeTokens).toBeGreaterThan(16_384);
      expect(previous.logs[2].netSavedTokens).toBeLessThan(0);
      expect(previous.logs[3].readTokens).toBe(previous.logs[2].writeTokens);
      expect(previous.logs[3].netSavedTokens).toBeGreaterThan(0);
      expect(previous.totalWriteTokens).toBeGreaterThan(16_384);
      expect(previous.totalReadTokens).toBe(previous.totalWriteTokens);
      expect(previous.totalNetSavedTokens).toBeGreaterThan(0);
    });

    it('한 번 생존한 16k 초과 prefix를 두 번째 요청에서 write한다', () => {
      const scenario = requireScenarioById('19-large-stable-prefix-admission');
      const previous = requireReplayResult(scenario, 'calibrated', 'production-two-survival');
      const current = requireReplayResult(scenario, 'calibrated', 'production');

      expect(current.logs.map((log) => log.policyMarkerCount)).toEqual([0, 1, 1, 1]);
      expect(current.logs[1].writeTokens).toBeGreaterThan(16_384);
      expect(current.logs[2].readTokens).toBe(current.logs[1].writeTokens);
      expect(current.totalReadTokens).toBe(current.totalWriteTokens * 2);
      expect(current.totalNetSavedTokens).toBeGreaterThan(previous.totalNetSavedTokens);
    });

    it('한 번만 재사용되고 깨지는 prefix도 첫 hit으로 write를 회수한다', () => {
      const scenario = requireScenarioById('20-large-prefix-invalidated-after-admission');
      const previous = requireReplayResult(scenario, 'calibrated', 'production-two-survival');
      const current = requireReplayResult(scenario, 'calibrated', 'production');

      expect(current.logs.map((log) => log.policyMarkerCount)).toEqual([0, 1, 1, 0]);
      expect(current.logs[1].writeTokens).toBeGreaterThan(16_384);
      expect(current.logs[2].readTokens).toBe(current.logs[1].writeTokens);
      expect(current.totalNetSavedTokens).toBeGreaterThan(0);
      expect(current.totalNetSavedTokens).toBeGreaterThan(previous.totalNetSavedTokens);
    });

    it('직전 두 번 생존 정책은 admission 직후 깨지면 cold write를 회수하지 못한다', () => {
      const scenario = requireScenarioById('20-large-prefix-invalidated-after-admission');
      const hardCapped = requireReplayResult(scenario, 'calibrated', 'selective-hard-cap');
      const previous = requireReplayResult(scenario, 'calibrated', 'production-two-survival');

      expect(hardCapped.logs.map((log) => log.policyMarkerCount)).toEqual([0, 0, 0, 0]);
      expect(hardCapped.totalNetSavedTokens).toBe(0);
      expect(previous.logs.map((log) => log.policyMarkerCount)).toEqual([0, 0, 1, 0]);
      expect(previous.logs[2].writeTokens).toBeGreaterThan(16_384);
      expect(previous.logs[2].netSavedTokens).toBeLessThan(0);
      expect(previous.logs[3].readTokens).toBe(0);
      expect(previous.totalReadTokens).toBe(0);
      expect(previous.totalWriteTokens).toBe(previous.logs[2].writeTokens);
      expect(previous.totalNetSavedTokens).toBeLessThan(0);
    });

    it('production bank와 hard cap 비교는 admission과 fork 차이를 함께 드러낸다', () => {
      const changedScenarioIds = scenarios
        .filter((scenario) => {
          const hardCapped = requireReplayResult(scenario, 'calibrated', 'selective-hard-cap');
          const selective = requireReplayResult(scenario, 'calibrated', 'production');
          return hardCapped.totalNetSavedTokens !== selective.totalNetSavedTokens;
        })
        .map((scenario) => scenario.id);

      expect(changedScenarioIds).toContain('01-append');
      expect(changedScenarioIds).toContain('19-large-stable-prefix-admission');
      expect(changedScenarioIds).toContain('20-large-prefix-invalidated-after-admission');
      expect(changedScenarioIds).not.toContain('02-cbs-trap');
      expect(changedScenarioIds).toContain('14-trim-saturation');
    });
  });
}
