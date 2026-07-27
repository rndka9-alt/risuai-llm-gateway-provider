import { describe, expect, it } from 'vitest';
import type { LlmMessage } from 'llm-io';
import {
  createEmptyProductionCacheSnapshot,
  createProductionCacheTransition,
} from '../../sim-runner/adapters';

function createMessage(role: LlmMessage['role'], text: string): LlmMessage {
  return { content: [{ text, type: 'text' }], role };
}

function breakpointIndexes(messages: readonly LlmMessage[]): number[] {
  return messages.flatMap((message, index) =>
    message.content.some(
      (part) =>
        (part.type === 'text' || part.type === 'image') && part.cacheBreakpoint !== undefined,
    )
      ? [index]
      : [],
  );
}

describe('prompt cache transition', () => {
  it('중간 snapshot에서 같은 장면을 재개하면 같은 전이를 만든다', () => {
    const stableSystem = createMessage('system', 'S'.repeat(6_000));
    const firstScene = [stableSystem, createMessage('user', 'first input')];
    const secondScene = [
      ...firstScene,
      createMessage('assistant', 'first response'),
      createMessage('user', 'second input'),
    ];
    const initialSnapshot = createEmptyProductionCacheSnapshot();
    const firstTransition = createProductionCacheTransition({
      messages: firstScene,
      previousSnapshot: initialSnapshot,
    });

    const continued = createProductionCacheTransition({
      messages: secondScene,
      previousSnapshot: firstTransition.nextSnapshot,
    });
    const resumed = createProductionCacheTransition({
      messages: secondScene,
      previousSnapshot: firstTransition.nextSnapshot,
    });

    expect(resumed).toEqual(continued);
    expect(breakpointIndexes(resumed.requestMessages).length).toBeGreaterThan(0);
    expect(initialSnapshot).toEqual(createEmptyProductionCacheSnapshot());
  });
});
