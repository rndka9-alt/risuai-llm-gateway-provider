#!/usr/bin/env node

/**
 * ⚠️ 비용 고지: 이 스크립트는 실제 API 키로 LLM Gateway에 유료 요청을 보내며,
 * 실행하는 즉시 계정에 비용이 청구됩니다. 시작 시 출력되는 모드별 예상 요청
 * 수(기본 48회 / --ttl 11회·약 60분)를 확인한 뒤 실행하세요.
 *
 * COST NOTICE: Running this script sends real, billable requests to the LLM
 * Gateway API with your key. Review the execution estimate printed at startup.
 * Syntax-checking with `node --check` does not execute the probe.
 *
 * Offline-authored, live API contract probe for LLM Gateway explicit prompt caching.
 *
 * Usage:
 *   node scripts/probe-cache-contract.mjs
 *   node scripts/probe-cache-contract.mjs --ttl
 *
 * API key (redacted from all output; sent only as the Authorization header):
 *   PROBE_API_KEY environment variable — see .env.sample and run with
 *   `node --env-file=.env scripts/probe-cache-contract.mjs`
 *
 * Environment overrides:
 *   PROBE_API_KEY, PROBE_MODEL, PROBE_BASE_URL, PROBE_SERVICE_TIER
 *
 * Default mode probes these hypotheses:
 *   N. Nested breakpoint writes are charged as a sum of prefix snapshots, the
 *      deepest prefix, or only bytes/tokens added beyond an existing prefix.
 *   F. A request can read an existing prefix and write a new frontier at once.
 *   R. More than 15 requests/minute on one prompt_cache_key degrades hit rate
 *      relative to the same launch pattern distributed across four keys.
 *   G. A byte-identical request can be served by LLM Gateway response caching.
 *
 * --ttl mode probes these hypotheses on independent keys:
 *   T. A 30-minute explicit prompt cache survives through 29/31/45/60 minutes.
 *   U. A hit at 25 minutes may renew the cache lifetime observed at 45 minutes.
 *
 * LLM Gateway documents response caching as a project-level Preferences setting
 * and does not document a request-level bypass header. G intentionally sends no
 * invented bypass header; all other scenarios vary their final user message so
 * they are not byte-identical requests.
 * Source: https://docs.llmgateway.io/features/caching/gateway-caching
 */

import { createHash } from 'node:crypto';

import {
  Llm,
  LlmHttpError,
  LLMGatewayProvider,
  OpenAIChatCompletionsFormat,
} from 'llm-io';

const DEFAULT_MODEL = 'gpt-5.6-sol';
const DEFAULT_BASE_URL = 'https://api.llmgateway.io/v1';
// 실측: 게이트웨이가 prompt_cache_key를 최대 64자로 거부한다(400,
// string_above_max_length). 최장 라벨(22자) + base36 타임스탬프에서도
// 64자를 넘지 않도록 접두사를 짧게 유지한다.
const CACHE_KEY_PREFIX = 'rlgp-probe:';
const REQUEST_DELAY_MILLISECONDS = 2_000;
const TTL_PROGRESS_INTERVAL_MILLISECONDS = 60_000;
const MAX_COMPLETION_TOKENS = 8;
const PREFIX_SEGMENT_CHARACTERS = 6_000;
const APPROXIMATE_CHARACTERS_PER_TOKEN = 4;
const RPM_BURST_PROBE_COUNT = 16;
const RPM_SPLIT_KEY_COUNT = 4;

const STABLE_PREFIX_PARAGRAPH = [
  'This deterministic passage is input for an explicit prompt cache contract probe.',
  'Its wording, order, punctuation, and spacing remain stable within one measured sequence.',
  'The passage describes an archive where readers compare maps, catalogs, field notes, route labels, weather stations, and numbered observations.',
  'Each sentence contributes ordinary English text without changing the instruction in the final user message.',
  'When answering, return only the short token requested by the final user message.',
].join(' ');

const BASIC_REQUEST_COUNTS = [
  ['N nested write accounting', 6],
  ['F read plus frontier write', 3],
  ['R same-key RPM versus split keys', 37],
  ['G gateway response cache', 2],
];
const TTL_REQUEST_COUNTS = [
  ['T independent TTL checkpoints', 8],
  ['U hit-renewal sequence', 3],
];

let apiKeyForRedaction;
let lastCacheKeyTimestamp = 0;

function redactApiKey(value) {
  const text = String(value);
  if (apiKeyForRedaction === undefined || apiKeyForRedaction.length === 0) {
    return text;
  }
  return text.split(apiKeyForRedaction).join('[REDACTED]');
}

function writeLine(value = '') {
  process.stdout.write(`${redactApiKey(value)}\n`);
}

function writeErrorLine(value) {
  process.stderr.write(`${redactApiKey(value)}\n`);
}

function describeError(error) {
  return error instanceof Error ? error.message : String(error);
}

function readOptionalEnvironmentVariable(name) {
  const value = process.env[name];
  if (value === undefined) return undefined;

  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function readApiKey() {
  const apiKey = readOptionalEnvironmentVariable('PROBE_API_KEY');
  if (apiKey === undefined) {
    throw new Error(
      'Set the PROBE_API_KEY environment variable (see .env.sample; e.g. `node --env-file=.env`).',
    );
  }
  apiKeyForRedaction = apiKey;
  return apiKey;
}

function parseArguments() {
  const argumentsList = process.argv.slice(2);
  const supportedArguments = new Set(['--ttl']);
  const unknownArguments = argumentsList.filter(
    (argument) => !supportedArguments.has(argument),
  );
  if (unknownArguments.length > 0) {
    throw new Error(`Unknown argument(s): ${unknownArguments.join(', ')}`);
  }

  return { ttlMode: argumentsList.includes('--ttl') };
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function createPromptCacheKey(label) {
  const currentTimestamp = Date.now();
  const uniqueTimestamp = Math.max(currentTimestamp, lastCacheKeyTimestamp + 1);
  lastCacheKeyTimestamp = uniqueTimestamp;
  const normalizedLabel = label.toLowerCase().replace(/[^a-z0-9]+/gu, '-');
  const promptCacheKey = `${CACHE_KEY_PREFIX}${normalizedLabel}:${uniqueTimestamp.toString(36)}`;
  if (promptCacheKey.length > 64) {
    throw new RangeError(`prompt_cache_key exceeds 64 characters: ${promptCacheKey}`);
  }
  return promptCacheKey;
}

function createExtraBody(promptCacheKey, serviceTier) {
  return {
    prompt_cache_options: { mode: 'explicit', ttl: '30m' },
    prompt_cache_key: promptCacheKey,
    ...(serviceTier === undefined ? {} : { service_tier: serviceTier }),
  };
}

function createLlmClient({ apiKey, baseUrl, extraBody, model }) {
  return new Llm({
    format: new OpenAIChatCompletionsFormat({ model, extraBody }),
    provider: new LLMGatewayProvider(
      baseUrl === undefined ? { apiKey } : { apiKey, baseUrl },
    ),
  });
}

function createScenarioClient({
  apiKey,
  baseUrl,
  cacheKeyLabel,
  model,
  requestedServiceTier,
}) {
  const promptCacheKey = createPromptCacheKey(cacheKeyLabel);
  const extraBody = createExtraBody(promptCacheKey, requestedServiceTier);
  return {
    client: createLlmClient({ apiKey, baseUrl, extraBody, model }),
    extraBody,
    promptCacheKey,
  };
}

function createStablePrefixSegments(namespace, segmentCount) {
  if (!Number.isInteger(segmentCount) || segmentCount < 1 || segmentCount > 3) {
    throw new RangeError('segmentCount must be an integer between 1 and 3.');
  }

  return Array.from({ length: segmentCount }, (_, segmentIndex) => {
    const namespaceDigest = sha256(`${namespace}:${segmentIndex}`).slice(0, 16);
    const paragraph = `Probe namespace ${namespaceDigest}; segment ${segmentIndex + 1}. ${STABLE_PREFIX_PARAGRAPH}\n`;
    return paragraph
      .repeat(Math.ceil(PREFIX_SEGMENT_CHARACTERS / paragraph.length))
      .slice(0, PREFIX_SEGMENT_CHARACTERS);
  });
}

function createPrefixMessage(segments, breakpointIndexes) {
  const breakpointIndexSet = new Set(breakpointIndexes);
  for (const breakpointIndex of breakpointIndexSet) {
    if (
      !Number.isInteger(breakpointIndex) ||
      breakpointIndex < 0 ||
      breakpointIndex >= segments.length
    ) {
      throw new RangeError(`Invalid breakpoint index: ${breakpointIndex}`);
    }
  }

  return {
    role: 'system',
    content: segments.map((text, segmentIndex) => ({
      type: 'text',
      text,
      ...(breakpointIndexSet.has(segmentIndex)
        ? { cacheBreakpoint: { mode: 'explicit' } }
        : {}),
    })),
  };
}

function createSingleDeepestBreakpointMessage(segments) {
  return createPrefixMessage(segments, [segments.length - 1]);
}

function createAllBreakpointMessage(segments) {
  return createPrefixMessage(
    segments,
    segments.map((_, segmentIndex) => segmentIndex),
  );
}

function createUserMessage(label) {
  return {
    role: 'user',
    content: [{ type: 'text', text: `Reply with exactly OK. Probe suffix ${label}.` }],
  };
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readResponseMetadata(rawResponse) {
  if (!isRecord(rawResponse)) {
    return {
      responseServiceTier: undefined,
      responseServiceTierPresent: false,
      usage: undefined,
    };
  }

  return {
    responseServiceTier: rawResponse.service_tier,
    responseServiceTierPresent: Object.hasOwn(rawResponse, 'service_tier'),
    usage: rawResponse.usage,
  };
}

async function runLlmRequest({
  client,
  label,
  messages,
  model,
  requestedServiceTier,
}) {
  const startedAt = Date.now();
  try {
    const output = await client.generate({
      messages,
      options: { maxTokens: MAX_COMPLETION_TOKENS },
    });
    const metadata = readResponseMetadata(output.raw);

    return {
      label,
      model,
      requestedServiceTier,
      httpStatus: 200,
      elapsedMilliseconds: Date.now() - startedAt,
      ...metadata,
    };
  } catch (error) {
    return {
      label,
      model,
      requestedServiceTier,
      httpStatus: error instanceof LlmHttpError ? error.status : undefined,
      elapsedMilliseconds: Date.now() - startedAt,
      errorBody: error instanceof LlmHttpError ? error.body : describeError(error),
      responseServiceTier: undefined,
      responseServiceTierPresent: false,
      usage: undefined,
    };
  }
}

function createChatCompletionsUrl(baseUrl) {
  return `${baseUrl.replace(/\/+$/u, '')}/chat/completions`;
}

function collectCacheSignalHeaders(headers) {
  return Object.fromEntries(
    [...headers.entries()].filter(([name]) => {
      const normalizedName = name.toLowerCase();
      return normalizedName.includes('cache') || normalizedName === 'age';
    }),
  );
}

function createResponseCore(rawResponse) {
  if (!isRecord(rawResponse)) return undefined;
  const { usage: ignoredUsage, ...responseCore } = rawResponse;
  void ignoredUsage;
  return responseCore;
}

async function runRawRequest({
  apiKey,
  baseUrl,
  body,
  label,
  model,
  requestedServiceTier,
}) {
  const requestBody = JSON.stringify(body);
  const startedAt = Date.now();

  try {
    const response = await fetch(createChatCompletionsUrl(baseUrl), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: requestBody,
    });
    const responseBody = await response.text();
    const commonResult = {
      label,
      model,
      requestedServiceTier,
      httpStatus: response.status,
      elapsedMilliseconds: Date.now() - startedAt,
      requestBodyHash: sha256(requestBody),
      responseBodyHash: sha256(responseBody),
      cacheSignalHeaders: collectCacheSignalHeaders(response.headers),
    };

    if (!response.ok) {
      return {
        ...commonResult,
        errorBody: responseBody,
        responseServiceTier: undefined,
        responseServiceTierPresent: false,
        usage: undefined,
      };
    }

    let rawResponse;
    try {
      rawResponse = JSON.parse(responseBody);
    } catch (error) {
      return {
        ...commonResult,
        errorBody: `Response body was not valid JSON (${describeError(error)}):\n${responseBody}`,
        responseServiceTier: undefined,
        responseServiceTierPresent: false,
        usage: undefined,
      };
    }

    const responseCore = createResponseCore(rawResponse);
    return {
      ...commonResult,
      ...readResponseMetadata(rawResponse),
      responseCoreHash:
        responseCore === undefined
          ? undefined
          : sha256(JSON.stringify(responseCore)),
      choicesHash:
        isRecord(rawResponse) && rawResponse.choices !== undefined
          ? sha256(JSON.stringify(rawResponse.choices))
          : undefined,
      responseId: isRecord(rawResponse) ? rawResponse.id : undefined,
      responseCreated: isRecord(rawResponse) ? rawResponse.created : undefined,
    };
  } catch (error) {
    return {
      label,
      model,
      requestedServiceTier,
      httpStatus: undefined,
      elapsedMilliseconds: Date.now() - startedAt,
      errorBody: describeError(error),
      responseServiceTier: undefined,
      responseServiceTierPresent: false,
      usage: undefined,
    };
  }
}

function formatJson(value) {
  return value === undefined ? '(absent)' : JSON.stringify(value, null, 2);
}

function printRequestResult(result) {
  writeLine();
  writeLine(`=== ${result.label} ===`);
  writeLine(`model: ${result.model}`);
  writeLine(`request service_tier: ${result.requestedServiceTier ?? '(omitted)'}`);
  writeLine(`HTTP status: ${result.httpStatus ?? '(unavailable)'}`);
  writeLine(`elapsed: ${result.elapsedMilliseconds} ms`);

  if (result.errorBody !== undefined) {
    writeLine('error body:');
    writeLine(result.errorBody);
    return;
  }

  writeLine('usage:');
  writeLine(formatJson(result.usage));
  writeLine(
    `response service_tier: ${
      result.responseServiceTierPresent
        ? formatJson(result.responseServiceTier)
        : '(absent)'
    }`,
  );

  if (result.requestBodyHash !== undefined) {
    writeLine(`request body sha256: ${result.requestBodyHash}`);
    writeLine(`response body sha256: ${result.responseBodyHash}`);
    writeLine(`response core sha256: ${result.responseCoreHash ?? '(absent)'}`);
    writeLine(`choices sha256: ${result.choicesHash ?? '(absent)'}`);
    writeLine(`response id: ${result.responseId ?? '(absent)'}`);
    writeLine(`response created: ${result.responseCreated ?? '(absent)'}`);
    writeLine(`cache-related headers: ${formatJson(result.cacheSignalHeaders)}`);
  }
}

function readCacheToken(result, fieldName) {
  if (result.errorBody !== undefined || !isRecord(result.usage)) {
    return undefined;
  }
  const promptTokenDetails = result.usage.prompt_tokens_details;
  if (!isRecord(promptTokenDetails)) return undefined;
  const value = promptTokenDetails[fieldName];
  return typeof value === 'number' ? value : undefined;
}

function readUsageNumber(result, path) {
  let currentValue = result.usage;
  for (const pathPart of path) {
    if (!isRecord(currentValue)) return undefined;
    currentValue = currentValue[pathPart];
  }
  return typeof currentValue === 'number' ? currentValue : undefined;
}

function formatObservedNumber(value) {
  return value === undefined ? 'absent' : String(value);
}

function createSummaryRow(scenario, observation, verdict) {
  return {
    scenario,
    observation: `(observed) ${observation}`,
    verdict: `(interpretation) ${verdict}`,
  };
}

function splitTableCell(value) {
  return String(value).split(/\r?\n/u);
}

function printSummaryRows(rows) {
  const headings = ['scenario', 'observation', 'verdict'];
  const headingRow = Object.fromEntries(
    headings.map((heading) => [heading, heading]),
  );
  const widths = headings.map((heading) =>
    Math.max(
      ...[headingRow, ...rows].flatMap((row) =>
        splitTableCell(row[heading]).map((line) => line.length),
      ),
    ),
  );
  const renderRow = (row) => {
    const cells = headings.map((heading) => splitTableCell(row[heading]));
    const rowHeight = Math.max(...cells.map((cell) => cell.length));
    return Array.from({ length: rowHeight }, (_, lineIndex) =>
      `| ${cells
        .map((cell, columnIndex) =>
          (cell[lineIndex] ?? '').padEnd(widths[columnIndex]),
        )
        .join(' | ')} |`,
    ).join('\n');
  };

  writeLine();
  writeLine('=== Observation summary ===');
  writeLine(renderRow(headingRow));
  writeLine(`|-${widths.map((width) => '-'.repeat(width)).join('-|-')}-|`);
  rows.forEach((row) => writeLine(renderRow(row)));
}

function sleep(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function executeSequentialRequests(requestTasks) {
  const results = [];
  for (let requestIndex = 0; requestIndex < requestTasks.length; requestIndex += 1) {
    const result = await requestTasks[requestIndex]();
    results.push(result);
    printRequestResult(result);
    if (requestIndex < requestTasks.length - 1) {
      await sleep(REQUEST_DELAY_MILLISECONDS);
    }
  }
  return results;
}

function resultMap(results) {
  return new Map(results.map((result) => [result.label.split(' ')[0], result]));
}

function closestCandidate(actual, candidates) {
  if (actual === undefined) return undefined;
  return candidates
    .map((candidate) => ({
      ...candidate,
      difference: Math.abs(actual - candidate.expected),
      tolerance: Math.max(256, candidate.expected * 0.15),
    }))
    .sort((left, right) => left.difference - right.difference)[0];
}

function describeClosestCandidate(candidate) {
  if (candidate === undefined) return 'classification unavailable';
  if (candidate.difference > candidate.tolerance) {
    return `none of the accounting candidates is close; nearest is ${candidate.name} (${candidate.expected})`;
  }
  return `${candidate.name} (${candidate.expected})`;
}

async function runNestedAccountingScenario(context) {
  writeLine();
  writeLine('##### N — nested breakpoint write accounting #####');

  const baselineOne = createScenarioClient({
    ...context,
    cacheKeyLabel: 'nested-baseline-one',
  });
  const baselineTwo = createScenarioClient({
    ...context,
    cacheKeyLabel: 'nested-baseline-two',
  });
  const baselineThree = createScenarioClient({
    ...context,
    cacheKeyLabel: 'nested-baseline-three',
  });
  const coldNested = createScenarioClient({
    ...context,
    cacheKeyLabel: 'nested-cold-three',
  });
  const warmNested = createScenarioClient({
    ...context,
    cacheKeyLabel: 'nested-warm-three',
  });

  const baselineOneSegments = createStablePrefixSegments('nested baseline one', 1);
  const baselineTwoSegments = createStablePrefixSegments('nested baseline two', 2);
  const baselineThreeSegments = createStablePrefixSegments('nested baseline three', 3);
  const coldNestedSegments = createStablePrefixSegments('nested cold three', 3);
  const warmNestedSegments = createStablePrefixSegments('nested warm three', 3);

  const results = await executeSequentialRequests([
    () =>
      runLlmRequest({
        client: baselineOne.client,
        label: 'N-B1 one-prefix baseline',
        messages: [
          createSingleDeepestBreakpointMessage(baselineOneSegments),
          createUserMessage('N-B1'),
        ],
        model: context.model,
        requestedServiceTier: context.requestedServiceTier,
      }),
    () =>
      runLlmRequest({
        client: baselineTwo.client,
        label: 'N-B2 two-prefix deepest baseline',
        messages: [
          createSingleDeepestBreakpointMessage(baselineTwoSegments),
          createUserMessage('N-B2'),
        ],
        model: context.model,
        requestedServiceTier: context.requestedServiceTier,
      }),
    () =>
      runLlmRequest({
        client: baselineThree.client,
        label: 'N-B3 three-prefix deepest baseline',
        messages: [
          createSingleDeepestBreakpointMessage(baselineThreeSegments),
          createUserMessage('N-B3'),
        ],
        model: context.model,
        requestedServiceTier: context.requestedServiceTier,
      }),
    () =>
      runLlmRequest({
        client: coldNested.client,
        label: 'N-COLD three nested breakpoints',
        messages: [
          createAllBreakpointMessage(coldNestedSegments),
          createUserMessage('N-COLD'),
        ],
        model: context.model,
        requestedServiceTier: context.requestedServiceTier,
      }),
    () =>
      runLlmRequest({
        client: warmNested.client,
        label: 'N-W1 warm-prefix seed',
        messages: [
          createSingleDeepestBreakpointMessage(warmNestedSegments.slice(0, 1)),
          createUserMessage('N-W1'),
        ],
        model: context.model,
        requestedServiceTier: context.requestedServiceTier,
      }),
    () =>
      runLlmRequest({
        client: warmNested.client,
        label: 'N-W3 warm then three nested breakpoints',
        messages: [
          createAllBreakpointMessage(warmNestedSegments),
          createUserMessage('N-W3'),
        ],
        model: context.model,
        requestedServiceTier: context.requestedServiceTier,
      }),
  ]);

  const byLabel = resultMap(results);
  const prefixOne = readCacheToken(byLabel.get('N-B1'), 'cache_write_tokens');
  const prefixTwo = readCacheToken(byLabel.get('N-B2'), 'cache_write_tokens');
  const prefixThree = readCacheToken(byLabel.get('N-B3'), 'cache_write_tokens');
  const coldWrite = readCacheToken(byLabel.get('N-COLD'), 'cache_write_tokens');
  const warmSeedWrite = readCacheToken(byLabel.get('N-W1'), 'cache_write_tokens');
  const warmWrite = readCacheToken(byLabel.get('N-W3'), 'cache_write_tokens');
  const warmRead = readCacheToken(byLabel.get('N-W3'), 'cached_tokens');

  if (
    prefixOne === undefined ||
    prefixTwo === undefined ||
    prefixThree === undefined
  ) {
    return createSummaryRow(
      'N',
      `baseline writes P1/P2/P3=${formatObservedNumber(prefixOne)}/${formatObservedNumber(prefixTwo)}/${formatObservedNumber(prefixThree)}; cold=${formatObservedNumber(coldWrite)}; warm=${formatObservedNumber(warmWrite)}`,
      'required baseline cache_write_tokens are absent, so accounting cannot be classified',
    );
  }

  const coldCandidate = closestCandidate(coldWrite, [
    { name: 'sum of all nested prefix lengths', expected: prefixOne + prefixTwo + prefixThree },
    { name: 'deepest prefix/union', expected: prefixThree },
  ]);
  const warmCandidate = closestCandidate(warmWrite, [
    { name: 'sum of newly created nested prefixes', expected: prefixTwo + prefixThree },
    { name: 'full deepest prefix rewrite', expected: prefixThree },
    {
      name: 'increment beyond existing P1',
      expected: Math.max(0, prefixThree - prefixOne),
    },
  ]);
  const warmClassification =
    warmRead !== undefined && warmRead > 0
      ? describeClosestCandidate(warmCandidate)
      : 'warm request did not report a P1 read, so its write classification is invalid';
  const coldPrefixSumTarget = prefixOne + prefixTwo + prefixThree;
  const warmNewPrefixSumTarget = prefixTwo + prefixThree;
  const warmIncrementTarget = Math.max(0, prefixThree - prefixOne);

  return createSummaryRow(
    'N',
    `P1/P2/P3=${prefixOne}/${prefixTwo}/${prefixThree}; cold write=${formatObservedNumber(coldWrite)} versus sum/deep=${coldPrefixSumTarget}/${prefixThree}; warm seed/write/read=${formatObservedNumber(warmSeedWrite)}/${formatObservedNumber(warmWrite)}/${formatObservedNumber(warmRead)} versus new-sum/full/increment=${warmNewPrefixSumTarget}/${prefixThree}/${warmIncrementTarget}`,
    `cold: ${describeClosestCandidate(coldCandidate)}; warm: ${warmClassification}`,
  );
}

async function runFrontierWriteScenario(context) {
  writeLine();
  writeLine('##### F — existing read plus new frontier write #####');

  const fullBaseline = createScenarioClient({
    ...context,
    cacheKeyLabel: 'frontier-full-baseline',
  });
  const progression = createScenarioClient({
    ...context,
    cacheKeyLabel: 'frontier-progression',
  });
  const baselineSegments = createStablePrefixSegments('frontier full baseline', 2);
  const progressionSegments = createStablePrefixSegments('frontier progression', 2);

  const results = await executeSequentialRequests([
    () =>
      runLlmRequest({
        client: fullBaseline.client,
        label: 'F-B2 full-P2 write baseline',
        messages: [
          createSingleDeepestBreakpointMessage(baselineSegments),
          createUserMessage('F-B2'),
        ],
        model: context.model,
        requestedServiceTier: context.requestedServiceTier,
      }),
    () =>
      runLlmRequest({
        client: progression.client,
        label: 'F-A P1 write',
        messages: [
          createSingleDeepestBreakpointMessage(progressionSegments.slice(0, 1)),
          createUserMessage('F-A'),
        ],
        model: context.model,
        requestedServiceTier: context.requestedServiceTier,
      }),
    () =>
      runLlmRequest({
        client: progression.client,
        label: 'F-B P1 read plus P2 frontier write',
        messages: [
          createAllBreakpointMessage(progressionSegments),
          createUserMessage('F-B'),
        ],
        model: context.model,
        requestedServiceTier: context.requestedServiceTier,
      }),
  ]);

  const byLabel = resultMap(results);
  const fullPrefixWrite = readCacheToken(byLabel.get('F-B2'), 'cache_write_tokens');
  const firstPrefixWrite = readCacheToken(byLabel.get('F-A'), 'cache_write_tokens');
  const frontierWrite = readCacheToken(byLabel.get('F-B'), 'cache_write_tokens');
  const existingRead = readCacheToken(byLabel.get('F-B'), 'cached_tokens');

  if (fullPrefixWrite === undefined || firstPrefixWrite === undefined) {
    return createSummaryRow(
      'F',
      `full P2/P1 baseline writes=${formatObservedNumber(fullPrefixWrite)}/${formatObservedNumber(firstPrefixWrite)}; request B read/write=${formatObservedNumber(existingRead)}/${formatObservedNumber(frontierWrite)}`,
      'required baseline cache_write_tokens are absent, so frontier accounting cannot be classified',
    );
  }

  const writeCandidate = closestCandidate(frontierWrite, [
    {
      name: 'incremental growth only',
      expected: Math.max(0, fullPrefixWrite - firstPrefixWrite),
    },
    { name: 'full new deepest prefix', expected: fullPrefixWrite },
  ]);
  const simultaneous =
    existingRead !== undefined &&
    existingRead > 0 &&
    frontierWrite !== undefined &&
    frontierWrite > 0;
  const incrementalTarget = Math.max(0, fullPrefixWrite - firstPrefixWrite);

  return createSummaryRow(
    'F',
    `baseline P1/P2=${firstPrefixWrite}/${fullPrefixWrite}; request B cached/write=${formatObservedNumber(existingRead)}/${formatObservedNumber(frontierWrite)} versus incremental/full=${incrementalTarget}/${fullPrefixWrite}`,
    `${simultaneous ? 'read and write coexist in one response' : 'read/write coexistence was not observed'}; write is closest to ${describeClosestCandidate(writeCandidate)}`,
  );
}

function createCacheHitStatistics(results) {
  const successfulResults = results.filter((result) => result.errorBody === undefined);
  const hits = results.filter((result) => {
    const cachedTokens = readCacheToken(result, 'cached_tokens');
    return cachedTokens !== undefined && cachedTokens > 0;
  }).length;
  return {
    attempts: results.length,
    errors: results.length - successfulResults.length,
    hits,
    hitRatePerAttempt: results.length === 0 ? 0 : hits / results.length,
    hitRatePerSuccess:
      successfulResults.length === 0 ? 0 : hits / successfulResults.length,
  };
}

function formatPercentage(value) {
  return `${(value * 100).toFixed(1)}%`;
}

async function runRpmScenario(context) {
  writeLine();
  writeLine('##### R — same-key RPM congestion #####');

  const hot = createScenarioClient({ ...context, cacheKeyLabel: 'rpm-hot-key' });
  const split = Array.from({ length: RPM_SPLIT_KEY_COUNT }, (_, keyIndex) =>
    createScenarioClient({
      ...context,
      cacheKeyLabel: `rpm-split-key-${keyIndex + 1}`,
    }),
  );
  const hotPrefix = createStablePrefixSegments('rpm hot prefix', 1);
  const splitPrefixes = split.map((_, keyIndex) =>
    createStablePrefixSegments(`rpm split prefix ${keyIndex + 1}`, 1),
  );

  const seedResults = await executeSequentialRequests([
    () =>
      runLlmRequest({
        client: hot.client,
        label: 'R-HOT-W hot-key seed',
        messages: [
          createSingleDeepestBreakpointMessage(hotPrefix),
          createUserMessage('R-HOT-W'),
        ],
        model: context.model,
        requestedServiceTier: context.requestedServiceTier,
      }),
    ...split.map((splitClient, keyIndex) => () =>
      runLlmRequest({
        client: splitClient.client,
        label: `R-S${keyIndex + 1}-W split-key seed`,
        messages: [
          createSingleDeepestBreakpointMessage(splitPrefixes[keyIndex]),
          createUserMessage(`R-S${keyIndex + 1}-W`),
        ],
        model: context.model,
        requestedServiceTier: context.requestedServiceTier,
      }),
    ),
  ]);

  const failedSeed = seedResults.find((result) => result.errorBody !== undefined);
  if (failedSeed !== undefined) {
    throw new Error(
      `RPM scenario stopped because seed request ${failedSeed.label} failed.`,
    );
  }
  const seedWithoutWrite = seedResults.find((result) => {
    const writeTokens = readCacheToken(result, 'cache_write_tokens');
    return writeTokens === undefined || writeTokens === 0;
  });
  if (seedWithoutWrite !== undefined) {
    throw new Error(
      `RPM scenario stopped because seed request ${seedWithoutWrite.label} did not report a cache write.`,
    );
  }

  writeLine();
  writeLine(
    `Launching ${RPM_BURST_PROBE_COUNT} hot-key probes and ${RPM_BURST_PROBE_COUNT} split-key controls in paired bursts every ${REQUEST_DELAY_MILLISECONDS} ms.`,
  );

  const hotPromises = [];
  const splitPromises = [];
  const hotLaunchTimes = [];
  for (let probeIndex = 0; probeIndex < RPM_BURST_PROBE_COUNT; probeIndex += 1) {
    const splitKeyIndex = probeIndex % RPM_SPLIT_KEY_COUNT;
    hotLaunchTimes.push(Date.now());
    hotPromises.push(
      runLlmRequest({
        client: hot.client,
        label: `R-HOT-${probeIndex + 1} hot-key burst`,
        messages: [
          createSingleDeepestBreakpointMessage(hotPrefix),
          createUserMessage(`R-HOT-${probeIndex + 1}`),
        ],
        model: context.model,
        requestedServiceTier: context.requestedServiceTier,
      }),
    );
    splitPromises.push(
      runLlmRequest({
        client: split[splitKeyIndex].client,
        label: `R-SPLIT-${probeIndex + 1} key-${splitKeyIndex + 1} control`,
        messages: [
          createSingleDeepestBreakpointMessage(splitPrefixes[splitKeyIndex]),
          createUserMessage(`R-SPLIT-${probeIndex + 1}`),
        ],
        model: context.model,
        requestedServiceTier: context.requestedServiceTier,
      }),
    );
    writeLine(
      `[burst] launched pair ${probeIndex + 1}/${RPM_BURST_PROBE_COUNT}`,
    );
    if (probeIndex < RPM_BURST_PROBE_COUNT - 1) {
      await sleep(REQUEST_DELAY_MILLISECONDS);
    }
  }

  const [hotResults, splitResults] = await Promise.all([
    Promise.all(hotPromises),
    Promise.all(splitPromises),
  ]);
  hotResults.forEach(printRequestResult);
  splitResults.forEach(printRequestResult);

  const hotStatistics = createCacheHitStatistics(hotResults);
  const splitStatistics = createCacheHitStatistics(splitResults);
  const launchSpanMilliseconds =
    hotLaunchTimes[hotLaunchTimes.length - 1] - hotLaunchTimes[0];
  const observedLaunchesPerMinute =
    launchSpanMilliseconds === 0
      ? Infinity
      : ((hotLaunchTimes.length - 1) * 60_000) / launchSpanMilliseconds;
  const hotDegraded =
    hotStatistics.hitRatePerAttempt + 0.1 < splitStatistics.hitRatePerAttempt ||
    hotStatistics.errors > splitStatistics.errors;

  return createSummaryRow(
    'R',
    `hot launches=${observedLaunchesPerMinute.toFixed(1)}/min; hot hits/errors=${hotStatistics.hits}/${hotStatistics.errors} of ${hotStatistics.attempts} (${formatPercentage(hotStatistics.hitRatePerAttempt)} per attempt, ${formatPercentage(hotStatistics.hitRatePerSuccess)} per success); split hits/errors=${splitStatistics.hits}/${splitStatistics.errors} of ${splitStatistics.attempts} (${formatPercentage(splitStatistics.hitRatePerAttempt)} per attempt, ${formatPercentage(splitStatistics.hitRatePerSuccess)} per success)`,
    hotDegraded
      ? 'same-key traffic degraded relative to the time-matched split-key control; consistent with key-local congestion'
      : 'no material same-key degradation was observed in this small burst; this does not establish the absence of an RPM limit',
  );
}

function usageLooksZero(result) {
  const promptTokens = readUsageNumber(result, ['prompt_tokens']);
  const completionTokens = readUsageNumber(result, ['completion_tokens']);
  const totalTokens = readUsageNumber(result, ['total_tokens']);
  return (
    promptTokens === 0 &&
    completionTokens === 0 &&
    totalTokens === 0
  );
}

function costLooksZero(result) {
  const totalCost = readUsageNumber(result, ['cost_details', 'total_cost']);
  const legacyCost = readUsageNumber(result, ['cost']);
  return totalCost === 0 || legacyCost === 0;
}

async function runGatewayResponseCacheScenario(context) {
  writeLine();
  writeLine('##### G — byte-identical gateway response cache #####');
  writeLine(
    'Gateway response caching must be enabled in Project Settings > Preferences to make a hit possible; no request-level bypass header is documented.',
  );

  const scenario = createScenarioClient({
    ...context,
    cacheKeyLabel: 'gateway-response-cache',
  });
  const prefixText = createStablePrefixSegments('gateway response cache', 1).join('');
  const body = {
    model: context.model,
    messages: [
      {
        role: 'user',
        content: `${prefixText}\nReply with exactly OK.`,
      },
    ],
    max_completion_tokens: MAX_COMPLETION_TOKENS,
    ...scenario.extraBody,
  };

  const results = await executeSequentialRequests([
    () =>
      runRawRequest({
        apiKey: context.apiKey,
        baseUrl: context.effectiveBaseUrl,
        body,
        label: 'G-1 identical request seed',
        model: context.model,
        requestedServiceTier: context.requestedServiceTier,
      }),
    () =>
      runRawRequest({
        apiKey: context.apiKey,
        baseUrl: context.effectiveBaseUrl,
        body,
        label: 'G-2 identical request replay',
        model: context.model,
        requestedServiceTier: context.requestedServiceTier,
      }),
  ]);

  const [firstResult, secondResult] = results;
  const identicalRequestBodies =
    firstResult.requestBodyHash !== undefined &&
    firstResult.requestBodyHash === secondResult.requestBodyHash;
  const identicalResponseBodies =
    firstResult.responseBodyHash !== undefined &&
    firstResult.responseBodyHash === secondResult.responseBodyHash;
  const identicalResponseCores =
    firstResult.responseCoreHash !== undefined &&
    firstResult.responseCoreHash === secondResult.responseCoreHash;
  const identicalChoices =
    firstResult.choicesHash !== undefined &&
    firstResult.choicesHash === secondResult.choicesHash;
  const zeroUsage = usageLooksZero(secondResult);
  const zeroCost = costLooksZero(secondResult);
  const cacheObserved = identicalRequestBodies && (zeroUsage || zeroCost);

  return createSummaryRow(
    'G',
    `request bodies equal=${identicalRequestBodies}; second zero usage/cost=${zeroUsage}/${zeroCost}; response body/core/choices equal=${identicalResponseBodies}/${identicalResponseCores}/${identicalChoices}; elapsed first/second=${firstResult.elapsedMilliseconds}/${secondResult.elapsedMilliseconds} ms; second cache headers=${formatJson(secondResult.cacheSignalHeaders)}`,
    cacheObserved
      ? 'gateway response-cache behavior was observed; zero usage or cost is the decisive signal'
      : 'gateway response-cache behavior was not established; identical output alone is insufficient, and caching may be disabled or may have missed',
  );
}

function formatDuration(milliseconds) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

async function waitUntil(targetTimestamp, eventLabel) {
  while (Date.now() < targetTimestamp) {
    const remainingMilliseconds = targetTimestamp - Date.now();
    writeLine(
      `[ttl progress] next event ${eventLabel} in ${formatDuration(remainingMilliseconds)}; target ${new Date(targetTimestamp).toISOString()}`,
    );
    await sleep(
      Math.min(remainingMilliseconds, TTL_PROGRESS_INTERVAL_MILLISECONDS),
    );
  }
}

function createTtlClientRecord(context, label, namespace) {
  const scenario = createScenarioClient({ ...context, cacheKeyLabel: label });
  return {
    ...scenario,
    namespace,
    prefixSegments: createStablePrefixSegments(namespace, 1),
    seededAt: undefined,
    seedResult: undefined,
  };
}

function createTtlCheckpointRow(checkpoint) {
  const cachedTokens = readCacheToken(checkpoint.probeResult, 'cached_tokens');
  const elapsedMinutes = checkpoint.probeResult.elapsedSinceSeedMinutes;
  let verdict;
  if (cachedTokens === undefined) {
    verdict = 'cached_tokens is absent, so survival cannot be classified';
  } else if (cachedTokens > 0) {
    verdict = `the original write survived at least ${elapsedMinutes.toFixed(2)} minutes`;
  } else if (checkpoint.checkpointMinutes < 30) {
    verdict = 'a pre-30-minute miss conflicts with the requested minimum TTL, but routing, eviction, or request failure remains a confound';
  } else {
    verdict = `the original write was not readable at ${elapsedMinutes.toFixed(2)} minutes; this bounds observed survival but does not identify the cause`;
  }
  return createSummaryRow(
    `T-${checkpoint.checkpointMinutes}`,
    `elapsed=${elapsedMinutes.toFixed(2)}m; cached_tokens=${formatObservedNumber(cachedTokens)}; cache_write_tokens=${formatObservedNumber(readCacheToken(checkpoint.probeResult, 'cache_write_tokens'))}`,
    verdict,
  );
}

function createTtlRefreshRow(refreshRecord) {
  const firstHitTokens = readCacheToken(refreshRecord.firstProbeResult, 'cached_tokens');
  const finalHitTokens = readCacheToken(refreshRecord.finalProbeResult, 'cached_tokens');
  let verdict;
  if (firstHitTokens === undefined || firstHitTokens === 0) {
    verdict = 'the 25-minute request did not establish a hit and may have rewritten the prefix, so TTL renewal is unclassifiable';
  } else if (finalHitTokens === undefined) {
    verdict = 'the 45-minute cached_tokens field is absent, so TTL renewal is unclassifiable';
  } else if (finalHitTokens === 0) {
    verdict = 'a miss 20 minutes after a confirmed hit is evidence against hit-based TTL renewal, though routing or eviction can also cause it';
  } else {
    verdict = 'the 45-minute hit is compatible with renewal, but does not prove it because 30 minutes is a minimum and the original entry may naturally live longer';
  }

  return createSummaryRow(
    'U',
    `25m elapsed=${refreshRecord.firstProbeResult.elapsedSinceSeedMinutes.toFixed(2)}m cached=${formatObservedNumber(firstHitTokens)}; 45m elapsed=${refreshRecord.finalProbeResult.elapsedSinceSeedMinutes.toFixed(2)}m cached=${formatObservedNumber(finalHitTokens)}`,
    verdict,
  );
}

async function runTtlMode(context) {
  writeLine();
  writeLine('##### T/U — TTL survival and hit renewal #####');
  writeLine(
    'This mode takes approximately 60 minutes plus request latency. Progress is printed at least once per minute while waiting.',
  );

  // Each survival checkpoint uses a separate seed. A miss can therefore write a
  // replacement without contaminating any later checkpoint in the curve.
  const checkpoints = [29, 31, 45, 60].map((checkpointMinutes) => ({
    checkpointMinutes,
    ...createTtlClientRecord(
      context,
      `ttl-${checkpointMinutes}-minutes`,
      `ttl independent ${checkpointMinutes} minutes`,
    ),
    probeResult: undefined,
  }));
  const refreshRecord = {
    ...createTtlClientRecord(
      context,
      'ttl-hit-refresh',
      'ttl hit refresh sequence',
    ),
    firstProbeResult: undefined,
    finalProbeResult: undefined,
  };
  const seedRecords = [...checkpoints, refreshRecord];

  for (let seedIndex = 0; seedIndex < seedRecords.length; seedIndex += 1) {
    const seedRecord = seedRecords[seedIndex];
    const result = await runLlmRequest({
      client: seedRecord.client,
      label:
        seedRecord === refreshRecord
          ? 'U-W hit-refresh seed'
          : `T-${seedRecord.checkpointMinutes}-W independent seed`,
      messages: [
        createSingleDeepestBreakpointMessage(seedRecord.prefixSegments),
        createUserMessage(`TTL-SEED-${seedIndex + 1}`),
      ],
      model: context.model,
      requestedServiceTier: context.requestedServiceTier,
    });
    seedRecord.seedResult = result;
    seedRecord.seededAt = Date.now();
    printRequestResult(result);
    if (result.errorBody !== undefined) {
      throw new Error(`TTL mode stopped because seed request ${result.label} failed.`);
    }
    const writeTokens = readCacheToken(result, 'cache_write_tokens');
    if (writeTokens === undefined || writeTokens === 0) {
      throw new Error(
        `TTL mode stopped because seed request ${result.label} did not report a cache write.`,
      );
    }
    if (seedIndex < seedRecords.length - 1) {
      await sleep(REQUEST_DELAY_MILLISECONDS);
    }
  }

  const scheduledEvents = [
    ...checkpoints.map((checkpoint) => ({
      label: `T-${checkpoint.checkpointMinutes}-R`,
      scheduledMinutes: checkpoint.checkpointMinutes,
      targetTimestamp:
        checkpoint.seededAt + checkpoint.checkpointMinutes * 60_000,
      record: checkpoint,
      resultField: 'probeResult',
    })),
    {
      label: 'U-25-R',
      scheduledMinutes: 25,
      targetTimestamp: refreshRecord.seededAt + 25 * 60_000,
      record: refreshRecord,
      resultField: 'firstProbeResult',
    },
    {
      label: 'U-45-R',
      scheduledMinutes: 45,
      targetTimestamp: refreshRecord.seededAt + 45 * 60_000,
      record: refreshRecord,
      resultField: 'finalProbeResult',
    },
  ].sort((left, right) => left.targetTimestamp - right.targetTimestamp);

  for (let eventIndex = 0; eventIndex < scheduledEvents.length; eventIndex += 1) {
    const event = scheduledEvents[eventIndex];
    await waitUntil(event.targetTimestamp, event.label);
    const probeStartedAt = Date.now();
    const result = await runLlmRequest({
      client: event.record.client,
      label: `${event.label} scheduled ${event.scheduledMinutes}m read`,
      messages: [
        createSingleDeepestBreakpointMessage(event.record.prefixSegments),
        createUserMessage(`${event.label}-${Date.now()}`),
      ],
      model: context.model,
      requestedServiceTier: context.requestedServiceTier,
    });
    result.elapsedSinceSeedMinutes =
      (probeStartedAt - event.record.seededAt) / 60_000;
    event.record[event.resultField] = result;
    printRequestResult(result);
    if (eventIndex < scheduledEvents.length - 1) {
      await sleep(REQUEST_DELAY_MILLISECONDS);
    }
  }

  return [
    ...checkpoints.map(createTtlCheckpointRow),
    createTtlRefreshRow(refreshRecord),
  ];
}

function printModeEstimate(ttlMode) {
  const requestCounts = ttlMode ? TTL_REQUEST_COUNTS : BASIC_REQUEST_COUNTS;
  const totalRequests = requestCounts.reduce(
    (total, [, requestCount]) => total + requestCount,
    0,
  );
  const segmentEquivalents = ttlMode ? 11 : 57;
  const approximateTokensPerSegment = Math.ceil(
    PREFIX_SEGMENT_CHARACTERS / APPROXIMATE_CHARACTERS_PER_TOKEN,
  );
  const approximatePromptTokens =
    segmentEquivalents * approximateTokensPerSegment;

  writeLine('=== Probe execution estimate ===');
  writeLine(`mode: ${ttlMode ? '--ttl' : 'default'}`);
  requestCounts.forEach(([label, requestCount]) => {
    writeLine(`- ${label}: ${requestCount} requests`);
  });
  writeLine(`total: ${totalRequests} requests`);
  writeLine(
    `approximate prompt volume: ${approximatePromptTokens.toLocaleString('en-US')} tokens (${segmentEquivalents} minimum-prefix equivalents)`,
  );
  writeLine(
    `maximum requested completion volume: ${(totalRequests * MAX_COMPLETION_TOKENS).toLocaleString('en-US')} tokens`,
  );
  writeLine(`inter-request delay / burst-pair interval: ${REQUEST_DELAY_MILLISECONDS} ms`);
  if (ttlMode) {
    writeLine('estimated wall time: approximately 60 minutes plus API latency');
  }
}

async function main() {
  const { ttlMode } = parseArguments();
  printModeEstimate(ttlMode);

  const apiKey = readApiKey();
  const model = readOptionalEnvironmentVariable('PROBE_MODEL') ?? DEFAULT_MODEL;
  const requestedServiceTier = readOptionalEnvironmentVariable('PROBE_SERVICE_TIER');
  const configuredBaseUrl = readOptionalEnvironmentVariable('PROBE_BASE_URL');
  const effectiveBaseUrl = configuredBaseUrl ?? DEFAULT_BASE_URL;
  const context = {
    apiKey,
    baseUrl: configuredBaseUrl,
    effectiveBaseUrl,
    model,
    requestedServiceTier,
  };

  writeLine();
  writeLine(`model: ${model}`);
  writeLine(`base URL: ${effectiveBaseUrl}`);
  writeLine(`service_tier: ${requestedServiceTier ?? '(omitted)'}`);

  if (ttlMode) {
    printSummaryRows(await runTtlMode(context));
    return;
  }

  const summaryRows = [];
  summaryRows.push(await runNestedAccountingScenario(context));
  summaryRows.push(await runFrontierWriteScenario(context));
  summaryRows.push(await runRpmScenario(context));
  summaryRows.push(await runGatewayResponseCacheScenario(context));
  printSummaryRows(summaryRows);
}

main().catch((error) => {
  writeErrorLine(`Probe failed before completion: ${describeError(error)}`);
  process.exitCode = 1;
});
