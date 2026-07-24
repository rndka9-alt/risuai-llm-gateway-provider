import { expect } from 'vitest';
import type { SimulationScenario } from '../../scenarios';
import { requireReplayResult } from './sim-context';

export function expectGoldenDirection(scenario: SimulationScenario): void {
  const calibrated = requireReplayResult(scenario, 'calibrated', 'legacy-production');
  const pessimistic = requireReplayResult(scenario, 'pessimistic', 'legacy-production');
  const optimistic = requireReplayResult(scenario, 'optimistic', 'legacy-production');

  if (scenario.id === '01-append') {
    expect(calibrated.totalNetSavedTokens).toBeGreaterThan(0);
    expect(calibrated.totalReadTokens).toBeGreaterThan(calibrated.totalWriteTokens);
    return;
  }
  if (scenario.id === '02-cbs-trap') {
    expect(calibrated.totalReadTokens).toBe(0);
    expect(calibrated.totalNetSavedTokens).toBeLessThanOrEqual(0);
    expect(Math.abs(calibrated.totalNetSavedTokens) / calibrated.totalInputTokens).toBeGreaterThan(
      0.2,
    );
    return;
  }
  if (scenario.id === '03-reverse-depth') {
    expect(calibrated.totalReadTokens).toBeGreaterThan(0);
    expect(calibrated.totalWriteTokens).toBeGreaterThan(0);
    expect(calibrated.totalNetSavedTokens).toBeGreaterThan(0);
    return;
  }
  if (scenario.id === '04-reroll') {
    expect(calibrated.totalReadTokens).toBeGreaterThan(0);
    expect(calibrated.totalNetSavedTokens).toBeGreaterThan(0);
    return;
  }
  if (scenario.id === '05-lore-toggle') {
    expect(calibrated.totalReadTokens).toBeGreaterThan(calibrated.totalWriteTokens);
    expect(calibrated.totalNetSavedTokens).toBeGreaterThan(0);
    return;
  }
  if (scenario.id === '06-context-trim') {
    expect(calibrated.totalReadTokens).toBeGreaterThan(0);
    expect(calibrated.totalNetSavedTokens).toBeGreaterThan(0);
    return;
  }
  if (scenario.id === '07-hypa-summary') {
    expect(calibrated.totalReadTokens).toBeGreaterThan(0);
    expect(calibrated.totalWriteTokens).toBeGreaterThan(0);
    expect(calibrated.logs.slice(-4).every((log) => log.writeTokens > 0)).toBe(true);
    expect(calibrated.totalNetSavedTokens).toBeGreaterThan(0);
    return;
  }
  if (scenario.id === '08-lua-post-edit') {
    expect(calibrated.totalReadTokens).toBeGreaterThan(0);
    expect(calibrated.totalNetSavedTokens).toBeGreaterThan(0);
    return;
  }
  if (scenario.id === '09-room-switch') {
    expect(calibrated.totalReadTokens).toBe(0);
    expect(calibrated.totalNetSavedTokens).toBeLessThan(0);
    expect(calibrated.logs.map((log) => log.consecutiveEpochResets)).toEqual([0, 1, 0]);
    // 과거엔 optimistic(partial-prefix)이 shared-global 부분 히트로 손실을
    // 줄였지만, 매칭이 exact로 실측 확정된(probe-cache-partial.mjs) 뒤로는
    // room switch 손실이 TTL 가정과 무관한 매칭 계약의 구조적 손실임을 고정한다.
    expect(optimistic.totalNetSavedTokens).toBe(calibrated.totalNetSavedTokens);
    return;
  }
  if (scenario.id === '10-ttl-gap') {
    expect(pessimistic.totalReadTokens).toBe(0);
    expect(pessimistic.totalNetSavedTokens).toBeLessThan(0);
    expect(optimistic.totalReadTokens).toBeGreaterThan(0);
    expect(optimistic.totalNetSavedTokens).toBeGreaterThan(0);
    expect(optimistic.totalNetSavedTokens).toBeGreaterThan(pessimistic.totalNetSavedTokens);
    return;
  }
  if (scenario.id === '11-churn-then-stable' || scenario.id === '12-churn-oscillating') {
    expect(calibrated.totalReadTokens).toBeGreaterThan(0);
    expect(calibrated.totalWriteTokens).toBeGreaterThan(0);
    expect(calibrated.totalNetSavedTokens).toBeGreaterThan(0);
    return;
  }
  if (scenario.id.startsWith('13-manual-summary-additive-')) {
    // 현실 크기에서는 summary 앞의 얕은 hit가 뒤쪽 대규모 write를 항상
    // 상각하지 못한다. 큰 history·mixed mask의 적자를 그대로 노출한다.
    expect(calibrated.totalReadTokens).toBeGreaterThan(0);
    if (
      [
        '13-manual-summary-additive-typical-110k',
        '13-manual-summary-additive-ceiling-150k',
        '13-manual-summary-additive-typical-110k-mixed',
        '13-manual-summary-additive-hist-32t',
      ].includes(scenario.id)
    ) {
      expect(calibrated.totalNetSavedTokens).toBeLessThan(0);
      return;
    }
    expect(calibrated.totalNetSavedTokens).toBeGreaterThan(0);
    return;
  }
  if (scenario.id === '14-trim-saturation') {
    // 3k~6k 응답 30개가 든 포화 창에서는 얕은 head read만으로 rolling
    // history의 대규모 write를 상각하지 못한다.
    expect(calibrated.totalReadTokens).toBeGreaterThan(0);
    expect(calibrated.totalNetSavedTokens).toBeLessThan(0);
    return;
  }
  if (scenario.id === '15-multi-room-roundrobin') {
    const bank = requireReplayResult(scenario, 'calibrated', 'production');
    const singleStateBaseline = requireReplayResult(
      scenario,
      'calibrated',
      'production-two-survival',
    );

    // 공유 헤더로 우연 채택되는 방들은 fork 그룹으로 갈라져 왕복 read를
    // 회복한다. 단일 상태 비교 정책보다 큰 순절감이 나는 방향을 고정한다.
    expect(calibrated.totalReadTokens).toBeGreaterThan(0);
    expect(calibrated.totalNetSavedTokens).toBeGreaterThan(0);
    expect(bank.totalNetSavedTokens).toBeGreaterThan(singleStateBaseline.totalNetSavedTokens);
    expect(bank.totalNetSavedTokens).toBeGreaterThan(0);
    return;
  }
  if (scenario.id === '16-group-speaker-rotation') {
    // 응답자별 description 교체(#1)가 요청마다 프리픽스 초입을 갈아, 공통
    // 프리픽스가 sub-1024 main뿐인 요청이 대부분이다 — 현 정책에선
    // no-cache(0)가 더 나은 케이스로 남는다.
    expect(calibrated.totalNetSavedTokens).toBeLessThan(0);
    return;
  }
  if (scenario.id === '17-mid-history-edits') {
    // 과거 개서(수정·롤백 재진행·이어쓰기·깊은 삭제)는 이벤트당 손실이
    // 유계라 append 구간의 히트가 상각한다.
    expect(calibrated.totalReadTokens).toBeGreaterThan(0);
    expect(calibrated.totalNetSavedTokens).toBeGreaterThan(0);
    return;
  }
  if (scenario.id === '18-suppressed-frontier-branch-boundary') {
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
  if (scenario.id === '19-large-stable-prefix-admission') {
    expect(calibrated.totalWriteTokens).toBeGreaterThan(16_384);
    expect(calibrated.totalReadTokens).toBeGreaterThan(calibrated.totalWriteTokens);
    expect(calibrated.totalNetSavedTokens).toBeGreaterThan(0);
    return;
  }
  if (scenario.id === '20-large-prefix-invalidated-after-admission') {
    expect(calibrated.totalWriteTokens).toBeGreaterThan(16_384);
    expect(calibrated.totalReadTokens).toBe(calibrated.totalWriteTokens);
    expect(calibrated.totalNetSavedTokens).toBeGreaterThan(0);
    return;
  }
  if (scenario.id === '21-content-addressed-roundrobin') {
    const bank = requireReplayResult(scenario, 'calibrated', 'production');
    expect(bank.totalReadTokens).toBeGreaterThan(calibrated.totalReadTokens);
    expect(bank.totalNetSavedTokens).toBeGreaterThan(calibrated.totalNetSavedTokens);
    expect(bank.totalNetSavedTokens).toBeGreaterThan(0);
    return;
  }
  if (scenario.id === '22-cross-churn-eviction') {
    const bank = requireReplayResult(scenario, 'calibrated', 'production');
    expect(bank.totalReadTokens).toBeGreaterThan(calibrated.totalReadTokens);
    expect(bank.totalNetSavedTokens).toBeGreaterThan(calibrated.totalNetSavedTokens);
    expect(bank.totalNetSavedTokens).toBeGreaterThan(0);
    return;
  }
  throw new Error(`No direction assertion is defined for ${scenario.id}.`);
}
