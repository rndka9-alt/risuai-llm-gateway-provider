import type { LlmMessage } from 'llm-io';
import { describe, expect, it } from 'vitest';
import {
  createAdaptiveTwoStrikeCachePolicy,
  createAdaptiveTwoStrikeRerollAwareCachePolicy,
  createFirstTurnSafeCachePolicy,
} from '../../strategies/cache-policies';
import { pluginStorage } from './sim-context';

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

export function registerAdaptivePolicyTransitions(): void {
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
}
