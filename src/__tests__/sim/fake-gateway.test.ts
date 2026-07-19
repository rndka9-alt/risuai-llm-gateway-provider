import { describe, expect, it } from 'vitest';
import { OpenAIChatCompletionsFormat, type JsonObject, type LlmMessage } from 'llm-io';
import { markCacheBreakpoints, planCacheAnchors } from '../../cache';
import { createFakeGatewayKernel } from './fake-gateway';

function createMarkedSystemMessage(segments: readonly string[]): LlmMessage {
  return {
    role: 'system',
    content: segments.map((text) => ({
      type: 'text',
      text,
      cacheBreakpoint: { mode: 'explicit' },
    })),
  };
}

function createDeepestMarkedSystemMessage(segments: readonly string[]): LlmMessage {
  return {
    role: 'system',
    content: segments.map((text, segmentIndex) => ({
      type: 'text',
      text,
      ...(segmentIndex === segments.length - 1
        ? { cacheBreakpoint: { mode: 'explicit' as const } }
        : {}),
    })),
  };
}

function createUserMessage(text: string): LlmMessage {
  return { role: 'user', content: [{ type: 'text', text }] };
}

function serialize(messages: readonly LlmMessage[], promptCacheKey: string): JsonObject {
  return new OpenAIChatCompletionsFormat({
    model: 'offline-simulation-model',
    extraBody: {
      prompt_cache_key: promptCacheKey,
      prompt_cache_options: { mode: 'explicit', ttl: '30m' },
    },
  }).createRequestBody({ messages });
}

describe('calibrated fake gateway contracts', () => {
  it('cold 중첩 breakpoint는 prefix 합이 아니라 최심 union만 write한다', () => {
    const kernel = createFakeGatewayKernel('calibrated');
    const key = 'nested-union';
    const accounting = kernel.process({
      atMinute: 0,
      promptCacheKey: key,
      requestBody: serialize(
        [
          createMarkedSystemMessage(['A'.repeat(5_000), 'B'.repeat(5_000), 'C'.repeat(5_000)]),
          createUserMessage('cold nested probe'),
        ],
        key,
      ),
    });
    const deepestPrefixTokens = Math.max(...accounting.markerPrefixTokens);
    const summedPrefixTokens = accounting.markerPrefixTokens.reduce(
      (total, tokenCount) => total + tokenCount,
      0,
    );

    expect(accounting.wireMarkerCount).toBe(3);
    expect(accounting.writeTokens).toBe(deepestPrefixTokens);
    expect(accounting.writeTokens).toBeLessThan(summedPrefixTokens);
  });

  it('기존 P1 read와 P3-P1 증분 write를 같은 요청에 회계한다', () => {
    const kernel = createFakeGatewayKernel('calibrated');
    const key = 'incremental-write';
    const segments = ['D'.repeat(5_000), 'E'.repeat(5_000), 'F'.repeat(5_000)];
    const seed = kernel.process({
      atMinute: 0,
      promptCacheKey: key,
      requestBody: serialize(
        [createMarkedSystemMessage(segments.slice(0, 1)), createUserMessage('seed P1')],
        key,
      ),
    });
    const growth = kernel.process({
      atMinute: 1,
      promptCacheKey: key,
      requestBody: serialize(
        [createMarkedSystemMessage(segments), createUserMessage('grow to P3')],
        key,
      ),
    });
    const deepestPrefixTokens = Math.max(...growth.markerPrefixTokens);

    expect(growth.readTokens).toBe(seed.writeTokens);
    expect(growth.readTokens).toBeGreaterThan(0);
    expect(growth.writeTokens).toBe(deepestPrefixTokens - growth.readTokens);
    expect(growth.writeTokens).toBeGreaterThan(0);
  });

  it('prompt_cache_key가 64자를 넘으면 거부한다', () => {
    const kernel = createFakeGatewayKernel('calibrated');
    const key = 'K'.repeat(65);
    const requestBody = serialize(
      [createMarkedSystemMessage(['G'.repeat(5_000)]), createUserMessage('oversized key')],
      key,
    );

    expect(() => kernel.process({ atMinute: 0, promptCacheKey: key, requestBody })).toThrow(
      'prompt_cache_key exceeds 64 characters',
    );
  });

  it('planner가 통과시킨 비ASCII prefix를 독립 tokenizer는 1024 미달로 거부할 수 있다', () => {
    const messages = [createUserMessage('한'.repeat(2_100)), createUserMessage('input')];
    const observedPlan = planCacheAnchors(null, messages);
    const confirmedPlan = planCacheAnchors(observedPlan.nextState, messages);
    const plan = planCacheAnchors(confirmedPlan.nextState, messages);
    const markedMessages = markCacheBreakpoints(messages, plan);
    const key = 'tokenizer-separation';
    const accounting = createFakeGatewayKernel('calibrated').process({
      atMinute: 0,
      promptCacheKey: key,
      requestBody: serialize(markedMessages, key),
    });

    expect(accounting.wireMarkerCount).toBe(1);
    expect(accounting.markerPrefixTokens[0]).toBeLessThan(1024);
    expect(accounting.readTokens).toBe(0);
    expect(accounting.writeTokens).toBe(0);
  });

  it('모든 preset은 marker 불일치 구간을 읽지 않고, partial은 명시적 override 전용이다', () => {
    // 이 시나리오(seed [P|I*] → branch [P|J*])는 probe-cache-partial.mjs의
    // R1/R2와 같은 모양이며, 실서버가 cached 0(exact 매칭)으로 실측 확정됐다.
    // 따라서 optimistic preset도 exact로 동작해야 하고, partial-prefix는
    // 가상 서버 탐구용 override로만 열린다.
    const exactKernel = createFakeGatewayKernel('calibrated');
    const optimisticKernel = createFakeGatewayKernel('optimistic');
    const partialKernel = createFakeGatewayKernel('optimistic', {
      markerMatchMode: 'partial-prefix',
    });
    const key = 'partial-prefix';
    const stablePrefix = 'H'.repeat(5_000);
    const seedBody = serialize(
      [
        createDeepestMarkedSystemMessage([stablePrefix, 'I'.repeat(2_000)]),
        createUserMessage('seed branch'),
      ],
      key,
    );
    const branchBody = serialize(
      [
        createDeepestMarkedSystemMessage([stablePrefix, 'J'.repeat(2_000)]),
        createUserMessage('diverged branch'),
      ],
      key,
    );
    exactKernel.process({ atMinute: 0, promptCacheKey: key, requestBody: seedBody });
    optimisticKernel.process({ atMinute: 0, promptCacheKey: key, requestBody: seedBody });
    partialKernel.process({ atMinute: 0, promptCacheKey: key, requestBody: seedBody });

    const exactBranch = exactKernel.process({
      atMinute: 1,
      promptCacheKey: key,
      requestBody: branchBody,
    });
    const optimisticBranch = optimisticKernel.process({
      atMinute: 1,
      promptCacheKey: key,
      requestBody: branchBody,
    });
    const partialBranch = partialKernel.process({
      atMinute: 1,
      promptCacheKey: key,
      requestBody: branchBody,
    });

    expect(exactBranch.readTokens).toBe(0);
    expect(optimisticBranch.readTokens).toBe(0);
    expect(partialBranch.readTokens).toBeGreaterThanOrEqual(1024);
  });
});
