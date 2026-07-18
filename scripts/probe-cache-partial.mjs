#!/usr/bin/env node

/**
 * 단일축 실측: explicit 캐시의 프리픽스 매칭이 exact-boundary인지 partial인지.
 *
 * 시뮬레이션 커널(calibrated=exact, optimistic=partial+무한TTL)의 두 가정 중
 * 매칭 모드만 분리해 확인한다. 모든 요청이 수 분 안에 이뤄져 TTL 축은 개입하지
 * 않는다.
 *
 * 시나리오 (동일 prompt_cache_key, 매 실행 고유 namespace):
 *   R1 seed:    [A|B*] u1  → entry(A+B) 생성 (write≈A+B, cached 0 기대)
 *   R2 probe:   [A|C*] u2  → entry(A+B)와 A까지만 공유, A 지점 boundary 없음
 *               - partial 매칭이면 cached≈A, exact-boundary면 cached 0
 *   R3 anchor:  [A*]   u3  → A 지점 boundary 명시 (exact 세계에서 A entry 생성)
 *   R4 reprobe: [A|D*] u4  → R2와 같은 모양. R3 이후엔 exact 세계에서도 cached≈A
 *               → R2 미스가 "A boundary 부재" 때문임을 분리 확인
 *   R5 sanity:  [A|D*] u4  → R4 완전 반복. cached≈A+D로 히트 경로 자체를 검증
 *
 * 실행: node --env-file=.env scripts/probe-cache-partial.mjs
 * 비용: 5요청 × ~4.5k 입력 토큰, 출력 8토큰 제한 — $0.1 미만.
 */

import { createHash } from 'node:crypto';

import { Llm, LLMGatewayProvider, LlmHttpError, OpenAIChatCompletionsFormat } from 'llm-io';

const DEFAULT_MODEL = 'gpt-5.6-sol';
const DEFAULT_BASE_URL = 'https://api.llmgateway.io/v1';
const CACHE_KEY_PREFIX = 'rlgp-probe:';
const REQUEST_DELAY_MILLISECONDS = 2_000;
const MAX_COMPLETION_TOKENS = 8;
const SEGMENT_CHARACTERS = 6_000;

const STABLE_PARAGRAPH =
  'Stable probe text records maps, routes, archive shelves, weather notes, and numbered observations for cache boundary checks. ';

function readEnvironmentVariable(name, fallback) {
  const value = process.env[name]?.trim();
  if (value !== undefined && value !== '') return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`Set the ${name} environment variable (see .env.sample; use node --env-file=.env).`);
}

function createSegment(namespace, label) {
  const digest = createHash('sha256').update(`${namespace}:${label}`).digest('hex').slice(0, 16);
  const paragraph = `Probe namespace ${digest}; segment ${label}. ${STABLE_PARAGRAPH}\n`;
  return paragraph.repeat(Math.ceil(SEGMENT_CHARACTERS / paragraph.length)).slice(0, SEGMENT_CHARACTERS);
}

function createPrefixMessage(segments) {
  return {
    role: 'system',
    content: segments.map(({ text, breakpoint }) => ({
      type: 'text',
      text,
      ...(breakpoint ? { cacheBreakpoint: { mode: 'explicit' } } : {}),
    })),
  };
}

function createUserMessage(label) {
  return {
    role: 'user',
    content: [{ type: 'text', text: `Reply with exactly OK. Probe suffix ${label}.` }],
  };
}

function readUsage(rawResponse) {
  const usage = rawResponse?.usage;
  const details = usage?.prompt_tokens_details;
  return {
    promptTokens: usage?.prompt_tokens,
    cachedTokens: details?.cached_tokens,
    cacheWriteTokens: details?.cache_write_tokens ?? details?.cache_creation_tokens,
    cost: usage?.cost,
  };
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function runRequest(client, label, messages) {
  try {
    const output = await client.generate({ messages, options: { maxTokens: MAX_COMPLETION_TOKENS } });
    const usage = readUsage(output.raw);
    console.log(
      `${label}: prompt=${usage.promptTokens} cached=${usage.cachedTokens} write=${usage.cacheWriteTokens} cost=${usage.cost}`,
    );
    return usage;
  } catch (error) {
    const status = error instanceof LlmHttpError ? error.status : 'n/a';
    throw new Error(`${label} failed (HTTP ${status}): ${error instanceof LlmHttpError ? error.body : error}`);
  }
}

async function main() {
  const apiKey = readEnvironmentVariable('PROBE_API_KEY');
  const model = readEnvironmentVariable('PROBE_MODEL', DEFAULT_MODEL);
  const baseUrl = readEnvironmentVariable('PROBE_BASE_URL', DEFAULT_BASE_URL);

  const namespace = Date.now().toString(36);
  const promptCacheKey = `${CACHE_KEY_PREFIX}partial:${namespace}`;
  const client = new Llm({
    format: new OpenAIChatCompletionsFormat({
      model,
      extraBody: {
        prompt_cache_options: { mode: 'explicit', ttl: '30m' },
        prompt_cache_key: promptCacheKey,
      },
    }),
    provider: new LLMGatewayProvider({ apiKey, baseUrl }),
  });

  const A = createSegment(namespace, 'A');
  const B = createSegment(namespace, 'B');
  const C = createSegment(namespace, 'C');
  const D = createSegment(namespace, 'D');

  console.log(`model=${model} key=${promptCacheKey}`);

  const r1 = await runRequest(client, 'R1-seed[A|B*]', [
    createPrefixMessage([{ text: A }, { text: B, breakpoint: true }]),
    createUserMessage('u1'),
  ]);
  await delay(REQUEST_DELAY_MILLISECONDS);
  const r2 = await runRequest(client, 'R2-probe[A|C*]', [
    createPrefixMessage([{ text: A }, { text: C, breakpoint: true }]),
    createUserMessage('u2'),
  ]);
  await delay(REQUEST_DELAY_MILLISECONDS);
  await runRequest(client, 'R3-anchor[A*]', [
    createPrefixMessage([{ text: A, breakpoint: true }]),
    createUserMessage('u3'),
  ]);
  await delay(REQUEST_DELAY_MILLISECONDS);
  const r4 = await runRequest(client, 'R4-reprobe[A|D*]', [
    createPrefixMessage([{ text: A }, { text: D, breakpoint: true }]),
    createUserMessage('u4'),
  ]);
  await delay(REQUEST_DELAY_MILLISECONDS);
  const r5 = await runRequest(client, 'R5-sanity[A|D*]', [
    createPrefixMessage([{ text: A }, { text: D, breakpoint: true }]),
    createUserMessage('u4'),
  ]);

  const segmentTokens = Math.round(SEGMENT_CHARACTERS / 4);
  const meaningfulHit = segmentTokens * 0.5;
  console.log('\n--- verdict ---');
  console.log(`R1 seed write=${r1.cacheWriteTokens} (A+B≈${segmentTokens * 2} 기대)`);
  if ((r2.cachedTokens ?? 0) >= meaningfulHit) {
    console.log(`R2 cached=${r2.cachedTokens} ≥ ${meaningfulHit} → PARTIAL-PREFIX 매칭 (boundary 없는 공유 프리픽스 재사용)`);
  } else if ((r4.cachedTokens ?? 0) >= meaningfulHit) {
    console.log(
      `R2 cached=${r2.cachedTokens}, R4 cached=${r4.cachedTokens} → EXACT-BOUNDARY 매칭 (A boundary 생성 후에만 히트)`,
    );
  } else {
    console.log(
      `R2 cached=${r2.cachedTokens}, R4 cached=${r4.cachedTokens} → 판정 불가 (R5 sanity=${r5.cachedTokens} 확인 필요)`,
    );
  }
  console.log(`R5 sanity cached=${r5.cachedTokens} (A+D≈${segmentTokens * 2} 기대, 히트 경로 검증)`);
}

void main().catch((error) => {
  console.error(String(error));
  process.exitCode = 1;
});
