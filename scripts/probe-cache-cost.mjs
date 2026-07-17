#!/usr/bin/env node

/**
 * ⚠️ 비용 고지: 이 스크립트는 실제 API 키로 LLM Gateway에 유료 요청을 보내며,
 * 실행하는 즉시 계정에 비용이 청구됩니다.
 *
 * COST NOTICE: Running this script sends real, billable requests to the LLM
 * Gateway API with your key. Syntax-checking with `node --check` does not
 * execute the probe.
 *
 * Explicit prompt cache behavior probe (write/read, breakpoint edge cases).
 *
 * Usage:
 *   node scripts/probe-cache-cost.mjs [--edge | --extra]
 *
 * API key (redacted from all output; sent only as the Authorization header):
 *   PROBE_API_KEY environment variable — see .env.sample and run with
 *   `node --env-file=.env scripts/probe-cache-cost.mjs`
 *
 * Environment overrides:
 *   PROBE_API_KEY, PROBE_MODEL, PROBE_BASE_URL, PROBE_SERVICE_TIER
 */

import {
  Llm,
  LlmHttpError,
  LLMGatewayProvider,
  OpenAIChatCompletionsFormat,
} from 'llm-io';

const DEFAULT_MODEL = 'gpt-5.6-sol';
const DEFAULT_BASE_URL = 'https://api.llmgateway.io/v1';
const CACHE_KEY_PREFIX = 'risuai:llm-gateway-provider:probe:';
const REQUEST_DELAY_MILLISECONDS = 2_000;
const MAX_COMPLETION_TOKENS = 32;

const LARGE_PREFIX_PARAGRAPH = [
  'This fixed English passage is input for a deterministic prompt cache validation probe.',
  'Its wording, order, punctuation, and spacing remain stable across every paired request.',
  'The passage describes a quiet archive where careful readers compare maps, catalogs, field notes, and numbered observations.',
  'Each sentence contributes predictable text without adding instructions that conflict with the final user request.',
  'When answering, follow the final user message and return only the exact token it requests.',
].join(' ');

// Six thousand stable ASCII characters comfortably exceed the 1,024-token cache threshold.
const LARGE_SYSTEM_TEXT = `${LARGE_PREFIX_PARAGRAPH}\n`
  .repeat(Math.ceil(6_000 / (LARGE_PREFIX_PARAGRAPH.length + 1)))
  .slice(0, 6_000);

const LARGE_ASSISTANT_PARAGRAPH = [
  'This fixed assistant passage represents a stable prior response for an explicit cache probe.',
  'Every word and punctuation mark remains unchanged between the write and read requests.',
  'The passage records observations about routes, weather stations, archive shelves, map labels, and verification notes.',
  'Its only purpose is to place an assistant text breakpoint safely beyond the minimum cacheable prefix length.',
].join(' ');

// The assistant text itself is roughly 1,500 tokens, so its breakpoint is not
// confounded with the 1,024-token minimum tested by the earlier D scenario.
const LARGE_ASSISTANT_TEXT = `${LARGE_ASSISTANT_PARAGRAPH}\n`
  .repeat(Math.ceil(9_000 / (LARGE_ASSISTANT_PARAGRAPH.length + 1)))
  .slice(0, 9_000);

const SHORT_SYSTEM_TEXT =
  'This short fixed system message is used only to observe how the explicit cache endpoint handles a breakpoint below its minimum cacheable prefix size. Reply with only the exact token requested by the user.';

const ADDITIONAL_BREAKPOINT_SEGMENTS = [
  'Checkpoint two extends the stable prefix with a compact inventory of maps, labels, dates, and observations. The exact prose remains unchanged so a later request can test the same boundary without ambiguity. ',
  'Checkpoint three adds another deterministic section about archived routes, weather notes, and catalog entries. It exists only to create a distinct cache boundary after the minimum token threshold. ',
  'Checkpoint four records a fixed comparison of northern trails, southern trails, river crossings, and station logs. Nothing in this section changes between the paired probe requests. ',
  'Checkpoint five closes the reusable prefix with a stable note about verification, repeatability, and careful observation. The following user question is intentionally outside this boundary. ',
];

let apiKeyForRedaction;
let lastCacheKeyTimestamp = 0;

function redactApiKey(value) {
  const text = String(value);
  if (apiKeyForRedaction === undefined || apiKeyForRedaction.length === 0) return text;
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
  const supportedArguments = new Set(['--edge', '--extra']);
  const unknownArguments = argumentsList.filter(
    (argument) => !supportedArguments.has(argument),
  );
  if (unknownArguments.length > 0) {
    throw new Error(`Unknown argument(s): ${unknownArguments.join(', ')}`);
  }

  const includeEdgeScenarios = argumentsList.includes('--edge');
  const includeExtraScenarios = argumentsList.includes('--extra');
  if (includeEdgeScenarios && includeExtraScenarios) {
    throw new Error('--edge and --extra cannot be used together.');
  }

  return { includeEdgeScenarios, includeExtraScenarios };
}

function installHttpStatusTracker() {
  const originalFetch = globalThis.fetch;
  if (typeof originalFetch !== 'function') {
    throw new Error('Global fetch is unavailable; Node.js 18 or newer is required.');
  }

  const boundFetch = originalFetch.bind(globalThis);
  let latestStatus;

  // Llm receives no fetch override. The Node global is wrapped only because llm-io
  // does not expose the successful response status in its parsed output.
  globalThis.fetch = async (input, init) => {
    const response = await boundFetch(input, init);
    latestStatus = response.status;
    return response;
  };

  return {
    readStatus() {
      return latestStatus;
    },
    reset() {
      latestStatus = undefined;
    },
    restore() {
      globalThis.fetch = originalFetch;
    },
  };
}

function createPromptCacheKey() {
  const currentTimestamp = Date.now();
  const uniqueTimestamp = Math.max(currentTimestamp, lastCacheKeyTimestamp + 1);
  lastCacheKeyTimestamp = uniqueTimestamp;
  return CACHE_KEY_PREFIX + uniqueTimestamp;
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

function createSystemMessage(text, includeBreakpoint) {
  return {
    role: 'system',
    content: [
      {
        type: 'text',
        text,
        ...(includeBreakpoint ? { cacheBreakpoint: { mode: 'explicit' } } : {}),
      },
    ],
  };
}

function createUserMessage(text, includeBreakpoint = false) {
  return {
    role: 'user',
    content: [
      {
        type: 'text',
        text,
        ...(includeBreakpoint ? { cacheBreakpoint: { mode: 'explicit' } } : {}),
      },
    ],
  };
}

function createMultiBreakpointSystemMessage(breakpointCount) {
  const segments = [LARGE_SYSTEM_TEXT, ...ADDITIONAL_BREAKPOINT_SEGMENTS];
  if (breakpointCount < 1 || breakpointCount > segments.length) {
    throw new RangeError(`breakpointCount must be between 1 and ${segments.length}`);
  }

  return {
    role: 'system',
    content: segments.slice(0, breakpointCount).map((text) => ({
      type: 'text',
      text,
      cacheBreakpoint: { mode: 'explicit' },
    })),
  };
}

function createOldestBreakpointProbeSystemMessage() {
  return {
    role: 'system',
    content: [
      {
        type: 'text',
        text: LARGE_SYSTEM_TEXT,
        cacheBreakpoint: { mode: 'explicit' },
      },
      {
        type: 'text',
        text: 'This branch deliberately diverges immediately after the oldest breakpoint.',
      },
    ],
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
  httpStatusTracker,
  label,
  messages,
  model,
  requestedServiceTier,
}) {
  httpStatusTracker.reset();

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
      httpStatus: httpStatusTracker.readStatus(),
      ...metadata,
    };
  } catch (error) {
    return {
      label,
      model,
      requestedServiceTier,
      httpStatus:
        error instanceof LlmHttpError ? error.status : httpStatusTracker.readStatus(),
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

async function runRawRequest({
  apiKey,
  baseUrl,
  extraBody,
  httpStatusTracker,
  label,
  messages,
  model,
  requestedServiceTier,
}) {
  httpStatusTracker.reset();

  const body = {
    model,
    messages,
    max_completion_tokens: MAX_COMPLETION_TOKENS,
    ...extraBody,
  };

  try {
    const response = await fetch(createChatCompletionsUrl(baseUrl), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const responseBody = await response.text();

    if (!response.ok) {
      return {
        label,
        model,
        requestedServiceTier,
        httpStatus: response.status,
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
        label,
        model,
        requestedServiceTier,
        httpStatus: response.status,
        errorBody: `Response body was not valid JSON (${describeError(error)}):\n${responseBody}`,
        responseServiceTier: undefined,
        responseServiceTierPresent: false,
        usage: undefined,
      };
    }

    return {
      label,
      model,
      requestedServiceTier,
      httpStatus: response.status,
      ...readResponseMetadata(rawResponse),
    };
  } catch (error) {
    return {
      label,
      model,
      requestedServiceTier,
      httpStatus: httpStatusTracker.readStatus(),
      errorBody: describeError(error),
      responseServiceTier: undefined,
      responseServiceTierPresent: false,
      usage: undefined,
    };
  }
}

function findFinalStreamingUsageChunk(responseBody) {
  const eventBlocks = responseBody.split(/\r?\n\r?\n/u);
  let finalUsageChunk;

  for (const eventBlock of eventBlocks) {
    const dataLines = eventBlock
      .split(/\r?\n/u)
      .filter((line) => line.startsWith('data:'));
    if (dataLines.length === 0) continue;

    const dataPayload = dataLines
      .map((line) => (line.startsWith('data: ') ? line.slice(6) : line.slice(5)))
      .join('\n');
    if (dataPayload === '[DONE]') continue;

    let parsedEvent;
    try {
      parsedEvent = JSON.parse(dataPayload);
    } catch (error) {
      throw new Error(
        `Streaming data event was not valid JSON (${describeError(error)}):\n${eventBlock}`,
      );
    }

    if (isRecord(parsedEvent) && isRecord(parsedEvent.usage)) {
      finalUsageChunk = { parsedEvent, raw: eventBlock };
    }
  }

  return finalUsageChunk;
}

async function runRawStreamingRequest({
  apiKey,
  baseUrl,
  extraBody,
  httpStatusTracker,
  label,
  messages,
  model,
  requestedServiceTier,
}) {
  httpStatusTracker.reset();

  const body = {
    model,
    messages,
    max_completion_tokens: MAX_COMPLETION_TOKENS,
    stream: true,
    stream_options: { include_usage: true },
    ...extraBody,
  };

  try {
    const response = await fetch(createChatCompletionsUrl(baseUrl), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const responseBody = await response.text();

    if (!response.ok) {
      return {
        label,
        model,
        requestedServiceTier,
        httpStatus: response.status,
        errorBody: responseBody,
        responseServiceTier: undefined,
        responseServiceTierPresent: false,
        streamingResponse: true,
        streamUsageChunkRaw: undefined,
        usage: undefined,
      };
    }

    let usageChunk;
    try {
      usageChunk = findFinalStreamingUsageChunk(responseBody);
    } catch (error) {
      return {
        label,
        model,
        requestedServiceTier,
        httpStatus: response.status,
        errorBody: `${describeError(error)}\nFull SSE response:\n${responseBody}`,
        responseServiceTier: undefined,
        responseServiceTierPresent: false,
        streamingResponse: true,
        streamUsageChunkRaw: undefined,
        usage: undefined,
      };
    }

    const metadata =
      usageChunk === undefined
        ? readResponseMetadata(undefined)
        : readResponseMetadata(usageChunk.parsedEvent);
    return {
      label,
      model,
      requestedServiceTier,
      httpStatus: response.status,
      ...metadata,
      streamingResponse: true,
      streamUsageChunkRaw: usageChunk === undefined ? undefined : usageChunk.raw,
    };
  } catch (error) {
    return {
      label,
      model,
      requestedServiceTier,
      httpStatus: httpStatusTracker.readStatus(),
      errorBody: describeError(error),
      responseServiceTier: undefined,
      responseServiceTierPresent: false,
      streamingResponse: true,
      streamUsageChunkRaw: undefined,
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
  writeLine(
    `request service_tier: ${result.requestedServiceTier ?? '(omitted)'}`,
  );
  writeLine(`HTTP status: ${result.httpStatus ?? '(unavailable)'}`);

  if (result.errorBody !== undefined) {
    writeLine('error body:');
    writeLine(result.errorBody);
    writeLine('response service_tier: (unavailable)');
    return;
  }

  if (result.streamingResponse === true) {
    writeLine('final usage SSE chunk (raw):');
    writeLine(result.streamUsageChunkRaw ?? '(absent)');
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
}

function observeCacheToken(result, fieldName) {
  if (result.errorBody !== undefined || !isRecord(result.usage)) {
    return { display: 'unavailable', value: undefined };
  }

  const promptTokenDetails = result.usage.prompt_tokens_details;
  if (!isRecord(promptTokenDetails)) {
    return { display: 'absent', value: undefined };
  }

  const value = promptTokenDetails[fieldName];
  return typeof value === 'number'
    ? { display: String(value), value }
    : { display: 'absent', value: undefined };
}

const ERROR_BODY_COLUMN = 'HTTP 400 error body (verbatim)';

function createSummaryRow(result, observation, verdict) {
  return {
    scenario: result.label.split(' ')[0],
    observation,
    verdict,
    // G keeps the complete transport body unparsed so client fallback matching can
    // be based on the gateway's actual code, param, message, and type fields.
    [ERROR_BODY_COLUMN]:
      result.httpStatus === 400 && result.errorBody !== undefined
        ? result.errorBody
        : '(none)',
  };
}

function formatHttpStatus(result) {
  return `HTTP ${result.httpStatus ?? 'unavailable'}`;
}

function formatCacheTokens(result) {
  const writeTokens = observeCacheToken(result, 'cache_write_tokens');
  const cachedTokens = observeCacheToken(result, 'cached_tokens');
  return {
    cachedTokens,
    display: `cache_write_tokens: ${writeTokens.display}; cached_tokens: ${cachedTokens.display}`,
    writeTokens,
  };
}

function createExpectedTokenRow(result, fieldName) {
  const token = observeCacheToken(result, fieldName);
  const passed = token.value !== undefined && token.value > 0;
  return createSummaryRow(
    result,
    `${formatHttpStatus(result)}; ${fieldName}: ${token.display}`,
    passed ? '✓' : '✗ expected > 0',
  );
}

function createNoCacheRow(result) {
  const cacheTokens = formatCacheTokens(result);
  const passed =
    cacheTokens.writeTokens.value === 0 && cacheTokens.cachedTokens.value === 0;
  return createSummaryRow(
    result,
    `${formatHttpStatus(result)}; ${cacheTokens.display}`,
    passed ? '✓' : '✗ expected both 0',
  );
}

function createSubThresholdRow(result) {
  if (result.errorBody !== undefined) {
    return createSummaryRow(
      result,
      formatHttpStatus(result),
      result.httpStatus === 400 ? 'rejected (observed)' : 'error (observed)',
    );
  }

  const cacheTokens = formatCacheTokens(result);
  const ignored =
    cacheTokens.writeTokens.value === 0 && cacheTokens.cachedTokens.value === 0;
  const fieldsAbsent =
    cacheTokens.writeTokens.value === undefined &&
    cacheTokens.cachedTokens.value === undefined;
  const verdict = ignored
    ? 'ignored (observed)'
    : fieldsAbsent
      ? 'cache fields absent (observed)'
      : 'accepted with cache usage (observed)';
  return createSummaryRow(
    result,
    `${formatHttpStatus(result)}; ${cacheTokens.display}`,
    verdict,
  );
}

function createRawMarkerRow(result, acceptedVerdict) {
  const verdict =
    result.errorBody === undefined
      ? acceptedVerdict
      : result.httpStatus === 400
        ? 'rejected; 400 body captured'
        : 'error (observed)';
  return createSummaryRow(result, formatHttpStatus(result), verdict);
}

function createMixedMinimumRow(result, fieldName, positiveVerdict, zeroVerdict) {
  if (result.errorBody !== undefined) {
    return createSummaryRow(
      result,
      formatHttpStatus(result),
      result.httpStatus === 400 ? 'rejected (observed)' : 'error (observed)',
    );
  }

  const token = observeCacheToken(result, fieldName);
  const verdict =
    token.value === undefined
      ? `${fieldName} absent (observed)`
      : token.value > 0
        ? positiveVerdict
        : zeroVerdict;
  return createSummaryRow(
    result,
    `${formatHttpStatus(result)}; ${fieldName}: ${token.display}`,
    verdict,
  );
}

function createBreakpointWriteRow(result, acceptedVerdict) {
  if (result.errorBody !== undefined) {
    return createSummaryRow(
      result,
      formatHttpStatus(result),
      result.httpStatus === 400 ? 'rejected (observed)' : 'error (observed)',
    );
  }

  const cacheTokens = formatCacheTokens(result);
  return createSummaryRow(
    result,
    `${formatHttpStatus(result)}; ${cacheTokens.display}`,
    acceptedVerdict,
  );
}

function createBreakpointReadRow(result, positiveVerdict, zeroVerdict) {
  if (result.errorBody !== undefined) {
    return createSummaryRow(
      result,
      formatHttpStatus(result),
      result.httpStatus === 400 ? 'rejected (observed)' : 'error (observed)',
    );
  }

  const cachedTokens = observeCacheToken(result, 'cached_tokens');
  const verdict =
    cachedTokens.value === undefined
      ? 'cached_tokens absent (observed)'
      : cachedTokens.value > 0
        ? positiveVerdict
        : zeroVerdict;
  return createSummaryRow(
    result,
    `${formatHttpStatus(result)}; cached_tokens: ${cachedTokens.display}`,
    verdict,
  );
}

function splitTableCell(value) {
  return String(value).split(/\r?\n/u);
}

function createStreamingUsageRow(result) {
  if (result.errorBody !== undefined) {
    return createSummaryRow(
      result,
      formatHttpStatus(result),
      result.httpStatus === 400 ? 'rejected (observed)' : 'error (observed)',
    );
  }

  const hasUsageChunk = typeof result.streamUsageChunkRaw === 'string';
  const hasUsage = isRecord(result.usage);
  const hasCost = hasUsage && typeof result.usage.cost === 'number';
  const hasCostDetails =
    hasUsage &&
    Object.hasOwn(result.usage, 'cost_details') &&
    isRecord(result.usage.cost_details);
  return createSummaryRow(
    result,
    `${formatHttpStatus(result)}; usage chunk: ${hasUsageChunk ? 'present' : 'absent'}; cost: ${hasCost ? 'present' : 'absent'}; cost_details: ${hasCostDetails ? 'present' : 'absent'}`,
    hasCost && hasCostDetails
      ? 'cost and cost_details available'
      : hasCost
        ? 'cost available; cost_details absent'
        : 'streaming USD metadata unavailable',
  );
}

function createReasoningEffortRow(result, reasoningEffort) {
  const verdict =
    result.errorBody === undefined
      ? `${reasoningEffort} accepted ✓`
      : result.httpStatus === 400
        ? `${reasoningEffort} rejected`
        : 'error (observed)';
  return createSummaryRow(result, formatHttpStatus(result), verdict);
}

function printSummaryRows(rows) {
  const headings = ['scenario', 'observation', 'verdict', ERROR_BODY_COLUMN];
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

function printSummary(results, includeEdgeScenarios) {
  const byScenario = new Map(
    results.map((result) => [result.label.split(' ')[0], result]),
  );
  const rows = [
    createExpectedTokenRow(byScenario.get('A-1'), 'cache_write_tokens'),
    createExpectedTokenRow(byScenario.get('A-2'), 'cached_tokens'),
    createNoCacheRow(byScenario.get('B-1')),
    createNoCacheRow(byScenario.get('B-2')),
  ];

  if (includeEdgeScenarios) {
    rows.push(
      createSubThresholdRow(byScenario.get('C')),
      createRawMarkerRow(byScenario.get('D'), 'accepted assistant text marker'),
      createMixedMinimumRow(
        byScenario.get('E-1'),
        'cache_write_tokens',
        'later breakpoint written',
        'all breakpoints ignored',
      ),
      createMixedMinimumRow(
        byScenario.get('E-2'),
        'cached_tokens',
        'later breakpoint read ✓',
        'later breakpoint not read',
      ),
      createBreakpointWriteRow(
        byScenario.get('F-4'),
        'accepted four-breakpoint baseline',
      ),
      createBreakpointWriteRow(
        byScenario.get('F-5-W'),
        'accepted five-breakpoint request',
      ),
      createBreakpointReadRow(
        byScenario.get('F-5-O'),
        'oldest-boundary probe hit cache',
        'oldest-boundary probe missed; consistent with latest four',
      ),
      createBreakpointReadRow(
        byScenario.get('F-5-L'),
        'latest breakpoint read ✓',
        'latest breakpoint not read',
      ),
      createRawMarkerRow(byScenario.get('H'), 'unsupported marker was accepted'),
    );
  }

  printSummaryRows(rows);
}

function printExtraSummary(results) {
  const byScenario = new Map(
    results.map((result) => [result.label.split(' ')[0], result]),
  );
  printSummaryRows([
    createExpectedTokenRow(byScenario.get('I-1'), 'cache_write_tokens'),
    createExpectedTokenRow(byScenario.get('I-2'), 'cached_tokens'),
    createStreamingUsageRow(byScenario.get('J')),
    createReasoningEffortRow(byScenario.get('K'), 'minimal'),
    createReasoningEffortRow(byScenario.get('L'), 'max'),
  ]);
}

function waitBetweenRequests() {
  return new Promise((resolve) => {
    setTimeout(resolve, REQUEST_DELAY_MILLISECONDS);
  });
}

async function executeRequestTasks(requestTasks) {
  const results = [];
  for (let index = 0; index < requestTasks.length; index += 1) {
    const result = await requestTasks[index]();
    results.push(result);
    printRequestResult(result);

    if (index < requestTasks.length - 1) {
      await waitBetweenRequests();
    }
  }
  return results;
}

function createExtraRequestTasks({
  apiKey,
  effectiveBaseUrl,
  httpStatusTracker,
  model,
  requestedServiceTier,
}) {
  const scenarioIExtraBody = createExtraBody(
    createPromptCacheKey(),
    requestedServiceTier,
  );
  const scenarioJExtraBody = createExtraBody(
    createPromptCacheKey(),
    requestedServiceTier,
  );
  const scenarioKExtraBody = {
    ...createExtraBody(createPromptCacheKey(), requestedServiceTier),
    reasoning_effort: 'minimal',
  };
  const scenarioLExtraBody = {
    ...createExtraBody(createPromptCacheKey(), requestedServiceTier),
    reasoning_effort: 'max',
  };
  const assistantPrefixMessage = {
    role: 'assistant',
    content: [
      {
        type: 'text',
        text: LARGE_ASSISTANT_TEXT,
        prompt_cache_breakpoint: { mode: 'explicit' },
      },
    ],
  };

  return [
    // I removes the earlier minimum-length confound by placing the assistant
    // breakpoint after roughly 1,500 tokens, then checks both write and read.
    () =>
      runRawRequest({
        apiKey,
        baseUrl: effectiveBaseUrl,
        extraBody: scenarioIExtraBody,
        httpStatusTracker,
        label: 'I-1 assistant breakpoint write',
        messages: [
          { role: 'system', content: 'Continue the prior assistant transcript.' },
          assistantPrefixMessage,
          { role: 'user', content: 'Reply with exactly NOVEMBER.' },
        ],
        model,
        requestedServiceTier,
      }),
    () =>
      runRawRequest({
        apiKey,
        baseUrl: effectiveBaseUrl,
        extraBody: scenarioIExtraBody,
        httpStatusTracker,
        label: 'I-2 assistant breakpoint read',
        messages: [
          { role: 'system', content: 'Continue the prior assistant transcript.' },
          assistantPrefixMessage,
          { role: 'user', content: 'Reply with exactly OSCAR.' },
        ],
        model,
        requestedServiceTier,
      }),
    // J captures the final SSE usage event verbatim to determine whether cost
    // metadata survives Chat Completions streaming.
    () =>
      runRawStreamingRequest({
        apiKey,
        baseUrl: effectiveBaseUrl,
        extraBody: scenarioJExtraBody,
        httpStatusTracker,
        label: 'J streaming usage',
        messages: [{ role: 'user', content: 'Reply with exactly PAPA.' }],
        model,
        requestedServiceTier,
      }),
    // K isolates whether GPT-5.6 accepts reasoning_effort=minimal at the HTTP API.
    () =>
      runRawRequest({
        apiKey,
        baseUrl: effectiveBaseUrl,
        extraBody: scenarioKExtraBody,
        httpStatusTracker,
        label: 'K minimal reasoning effort',
        messages: [{ role: 'user', content: 'Reply with exactly QUEBEC.' }],
        model,
        requestedServiceTier,
      }),
    // L directly tests max instead of inferring support from K's advertised list,
    // because other OpenAI surfaces expose a max reasoning effort.
    () =>
      runRawRequest({
        apiKey,
        baseUrl: effectiveBaseUrl,
        extraBody: scenarioLExtraBody,
        httpStatusTracker,
        label: 'L max reasoning effort',
        messages: [{ role: 'user', content: 'Reply with exactly ROMEO.' }],
        model,
        requestedServiceTier,
      }),
  ];
}

async function main() {
  const { includeEdgeScenarios, includeExtraScenarios } = parseArguments();
  const apiKey = readApiKey();
  const model = readOptionalEnvironmentVariable('PROBE_MODEL') ?? DEFAULT_MODEL;
  const requestedServiceTier = readOptionalEnvironmentVariable('PROBE_SERVICE_TIER');
  const configuredBaseUrl = readOptionalEnvironmentVariable('PROBE_BASE_URL');
  const effectiveBaseUrl = configuredBaseUrl ?? DEFAULT_BASE_URL;
  const httpStatusTracker = installHttpStatusTracker();

  if (includeExtraScenarios) {
    let extraResults;
    try {
      extraResults = await executeRequestTasks(
        createExtraRequestTasks({
          apiKey,
          effectiveBaseUrl,
          httpStatusTracker,
          model,
          requestedServiceTier,
        }),
      );
    } finally {
      httpStatusTracker.restore();
    }
    printExtraSummary(extraResults);
    return;
  }

  const scenarioAExtraBody = createExtraBody(
    createPromptCacheKey(),
    requestedServiceTier,
  );
  const scenarioBExtraBody = createExtraBody(
    createPromptCacheKey(),
    requestedServiceTier,
  );
  const scenarioAClient = createLlmClient({
    apiKey,
    baseUrl: configuredBaseUrl,
    extraBody: scenarioAExtraBody,
    model,
  });
  const scenarioBClient = createLlmClient({
    apiKey,
    baseUrl: configuredBaseUrl,
    extraBody: scenarioBExtraBody,
    model,
  });
  const markedLargeSystemMessage = createSystemMessage(LARGE_SYSTEM_TEXT, true);
  const unmarkedLargeSystemMessage = createSystemMessage(LARGE_SYSTEM_TEXT, false);

  const requestTasks = [
    // A confirms that an explicit system breakpoint writes once and is read by
    // the next request with the same stable prefix and cache key.
    () =>
      runLlmRequest({
        client: scenarioAClient,
        httpStatusTracker,
        label: 'A-1 cache write',
        messages: [
          markedLargeSystemMessage,
          createUserMessage('Reply with exactly ALPHA.'),
        ],
        model,
        requestedServiceTier,
      }),
    () =>
      runLlmRequest({
        client: scenarioAClient,
        httpStatusTracker,
        label: 'A-2 cache read',
        messages: [
          markedLargeSystemMessage,
          createUserMessage('Reply with exactly BRAVO.'),
        ],
        model,
        requestedServiceTier,
      }),
    // B confirms that explicit mode does not cache a long prefix when no message
    // content part carries a breakpoint.
    () =>
      runLlmRequest({
        client: scenarioBClient,
        httpStatusTracker,
        label: 'B-1 explicit without breakpoint',
        messages: [
          unmarkedLargeSystemMessage,
          createUserMessage('Reply with exactly CHARLIE.'),
        ],
        model,
        requestedServiceTier,
      }),
    () =>
      runLlmRequest({
        client: scenarioBClient,
        httpStatusTracker,
        label: 'B-2 explicit without breakpoint',
        messages: [
          unmarkedLargeSystemMessage,
          createUserMessage('Reply with exactly ECHO.'),
        ],
        model,
        requestedServiceTier,
      }),
  ];

  if (includeEdgeScenarios) {
    const scenarioCExtraBody = createExtraBody(
      createPromptCacheKey(),
      requestedServiceTier,
    );
    const scenarioDExtraBody = createExtraBody(
      createPromptCacheKey(),
      requestedServiceTier,
    );
    const scenarioEExtraBody = createExtraBody(
      createPromptCacheKey(),
      requestedServiceTier,
    );
    const scenarioF4ExtraBody = createExtraBody(
      createPromptCacheKey(),
      requestedServiceTier,
    );
    const scenarioF5ExtraBody = createExtraBody(
      createPromptCacheKey(),
      requestedServiceTier,
    );
    const scenarioHExtraBody = createExtraBody(
      createPromptCacheKey(),
      requestedServiceTier,
    );
    const scenarioCClient = createLlmClient({
      apiKey,
      baseUrl: configuredBaseUrl,
      extraBody: scenarioCExtraBody,
      model,
    });
    const scenarioEClient = createLlmClient({
      apiKey,
      baseUrl: configuredBaseUrl,
      extraBody: scenarioEExtraBody,
      model,
    });
    const scenarioF4Client = createLlmClient({
      apiKey,
      baseUrl: configuredBaseUrl,
      extraBody: scenarioF4ExtraBody,
      model,
    });
    const scenarioF5Client = createLlmClient({
      apiKey,
      baseUrl: configuredBaseUrl,
      extraBody: scenarioF5ExtraBody,
      model,
    });
    const fourBreakpointSystemMessage = createMultiBreakpointSystemMessage(4);
    const fiveBreakpointSystemMessage = createMultiBreakpointSystemMessage(5);

    requestTasks.push(
      // C isolates a request whose only breakpoint is below 1,024 tokens and
      // observes whether the gateway rejects it or accepts it without caching.
      () =>
        runLlmRequest({
          client: scenarioCClient,
          httpStatusTracker,
          label: 'C sub-1024 breakpoint',
          messages: [
            createSystemMessage(SHORT_SYSTEM_TEXT, true),
            createUserMessage('Reply with exactly FOXTROT.'),
          ],
          model,
          requestedServiceTier,
        }),
      // D sends the documented assistant text-part shape with raw fetch because
      // llm-io intentionally serializes assistant text as a plain string.
      () =>
        runRawRequest({
          apiKey,
          baseUrl: effectiveBaseUrl,
          extraBody: scenarioDExtraBody,
          httpStatusTracker,
          label: 'D assistant breakpoint',
          messages: [
            { role: 'system', content: LARGE_SYSTEM_TEXT },
            {
              role: 'assistant',
              content: [
                {
                  type: 'text',
                  text: 'This assistant message ends the proposed reusable prefix.',
                  prompt_cache_breakpoint: { mode: 'explicit' },
                },
              ],
            },
            { role: 'user', content: 'Reply with exactly DELTA.' },
          ],
          model,
          requestedServiceTier,
        }),
      // E places the first breakpoint below 1,024 tokens and a second breakpoint
      // after a long user message, then checks whether only the valid one survives.
      () =>
        runLlmRequest({
          client: scenarioEClient,
          httpStatusTracker,
          label: 'E-1 mixed-minimum write',
          messages: [
            createSystemMessage(SHORT_SYSTEM_TEXT, true),
            createUserMessage(LARGE_SYSTEM_TEXT, true),
            createUserMessage('Reply with exactly GOLF.'),
          ],
          model,
          requestedServiceTier,
        }),
      () =>
        runLlmRequest({
          client: scenarioEClient,
          httpStatusTracker,
          label: 'E-2 mixed-minimum read',
          messages: [
            createSystemMessage(SHORT_SYSTEM_TEXT, true),
            createUserMessage(LARGE_SYSTEM_TEXT, true),
            createUserMessage('Reply with exactly HOTEL.'),
          ],
          model,
          requestedServiceTier,
        }),
      // F first records a four-breakpoint baseline, then writes five breakpoints
      // and probes the oldest and latest boundaries to distinguish latest-four behavior.
      () =>
        runLlmRequest({
          client: scenarioF4Client,
          httpStatusTracker,
          label: 'F-4 four-breakpoint baseline',
          messages: [
            fourBreakpointSystemMessage,
            createUserMessage('Reply with exactly INDIA.'),
          ],
          model,
          requestedServiceTier,
        }),
      () =>
        runLlmRequest({
          client: scenarioF5Client,
          httpStatusTracker,
          label: 'F-5-W five-breakpoint write',
          messages: [
            fiveBreakpointSystemMessage,
            createUserMessage('Reply with exactly JULIET.'),
          ],
          model,
          requestedServiceTier,
        }),
      () =>
        runLlmRequest({
          client: scenarioF5Client,
          httpStatusTracker,
          label: 'F-5-O oldest-breakpoint read probe',
          messages: [
            createOldestBreakpointProbeSystemMessage(),
            createUserMessage('Reply with exactly KILO.'),
          ],
          model,
          requestedServiceTier,
        }),
      () =>
        runLlmRequest({
          client: scenarioF5Client,
          httpStatusTracker,
          label: 'F-5-L latest-breakpoint read probe',
          messages: [
            fiveBreakpointSystemMessage,
            createUserMessage('Reply with exactly LIMA.'),
          ],
          model,
          requestedServiceTier,
        }),
      // H deliberately places a marker on a tool-call object, which is outside
      // the supported content-part allow-list, to collect the gateway's 400 signature.
      () =>
        runRawRequest({
          apiKey,
          baseUrl: effectiveBaseUrl,
          extraBody: scenarioHExtraBody,
          httpStatusTracker,
          label: 'H unsupported tool-call breakpoint',
          messages: [
            { role: 'system', content: LARGE_SYSTEM_TEXT },
            {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'probe_tool_call',
                  type: 'function',
                  function: { name: 'probe_function', arguments: '{}' },
                  prompt_cache_breakpoint: { mode: 'explicit' },
                },
              ],
            },
            {
              role: 'tool',
              tool_call_id: 'probe_tool_call',
              content: 'Probe tool result.',
            },
            { role: 'user', content: 'Reply with exactly MIKE.' },
          ],
          model,
          requestedServiceTier,
        }),
    );
  }

  let results;
  try {
    results = await executeRequestTasks(requestTasks);
  } finally {
    httpStatusTracker.restore();
  }

  printSummary(results, includeEdgeScenarios);
}

main().catch((error) => {
  writeErrorLine(`Probe failed before completion: ${describeError(error)}`);
  process.exitCode = 1;
});
