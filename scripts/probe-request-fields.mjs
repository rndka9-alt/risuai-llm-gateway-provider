#!/usr/bin/env node

/**
 * ⚠️ 비용 고지: --dry-run 없이 실행하면 실제 API 키로 LLM Gateway에
 * 유료 요청을 보낸다. 전체 실행은 23회 HTTP 요청이며, 실행 여부는
 * 반드시 사용자가 결정해야 한다.
 *
 * COST NOTICE: Running without --dry-run sends real, billable requests to the
 * hosted LLM Gateway API. Dry-run prints request bodies and never reads the API
 * key or performs network I/O.
 *
 * GPT-5.6 × llmgateway.io hosted request-field probe. The editor contract in
 * src/request-body-schema.ts is the source of truth; rejected and dropped cases
 * deliberately exercise fields excluded from that strict schema.
 *
 * Usage:
 *   node scripts/probe-request-fields.mjs --dry-run
 *   node scripts/probe-request-fields.mjs --dry-run --only active-max-tokens
 *   node --env-file=.env scripts/probe-request-fields.mjs
 *   node --env-file=.env scripts/probe-request-fields.mjs --only reject-reasoning-minimal
 *
 * API key (redacted from all output; sent only as the Authorization header):
 *   PROBE_API_KEY environment variable — see .env.sample.
 *
 * Environment overrides:
 *   PROBE_API_KEY, PROBE_MODEL, PROBE_BASE_URL
 */

const DEFAULT_MODEL = 'gpt-5.6-luna';
const DEFAULT_BASE_URL = 'https://api.llmgateway.io/v1';
const REQUEST_DELAY_MILLISECONDS = 2_000;
const CACHE_PREFIX_CHARACTERS = 6_000;
const ALLOWED_MODELS = new Set(['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']);

const STATUS = Object.freeze({
  verified: 'VERIFIED',
  dropped: 'DROPPED',
  rejected: 'REJECTED(400)',
  unverifiable: 'UNVERIFIABLE',
});

// 2026-07 hosted list prices per one million tokens. Estimates are deliberately
// conservative: cache-write premium is folded into the cache case's input count,
// while expected preflight 400 responses count as zero billable tokens.
const MODEL_PRICES = Object.freeze({
  'gpt-5.6-luna': { input: 1, output: 6 },
  'gpt-5.6-terra': { input: 2.5, output: 15 },
  'gpt-5.6-sol': { input: 5, output: 30 },
});

const CACHE_PREFIX_PARAGRAPH = [
  'This stable passage exists only for an explicit prompt cache field probe.',
  'Its wording, order, punctuation, and spacing remain byte-identical between requests.',
  'It records maps, archive shelves, route labels, weather notes, and numbered observations.',
  'The final user message supplies the only instruction that should be answered.',
].join(' ');

const CACHE_PREFIX_TEXT = `${CACHE_PREFIX_PARAGRAPH}\n`
  .repeat(Math.ceil(CACHE_PREFIX_CHARACTERS / (CACHE_PREFIX_PARAGRAPH.length + 1)))
  .slice(0, CACHE_PREFIX_CHARACTERS);

const ONE_PIXEL_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

let apiKeyForRedaction;

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

function readEnvironmentVariable(name, fallback) {
  const value = readOptionalEnvironmentVariable(name);
  if (value !== undefined) return value;
  if (fallback !== undefined) return fallback;
  throw new Error(
    `Set the ${name} environment variable (see .env.sample; use node --env-file=.env).`,
  );
}

function readApiKey() {
  const apiKey = readEnvironmentVariable('PROBE_API_KEY');
  apiKeyForRedaction = apiKey;
  return apiKey;
}

function parseArguments(caseNames) {
  const argumentsList = process.argv.slice(2);
  let dryRun = false;
  let onlyCaseName;

  for (let argumentIndex = 0; argumentIndex < argumentsList.length; argumentIndex += 1) {
    const argument = argumentsList[argumentIndex];
    if (argument === '--dry-run') {
      dryRun = true;
      continue;
    }

    if (argument === '--only') {
      const value = argumentsList[argumentIndex + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error('--only requires a case name.');
      }
      if (onlyCaseName !== undefined) throw new Error('--only may be specified only once.');
      onlyCaseName = value;
      argumentIndex += 1;
      continue;
    }

    if (argument.startsWith('--only=')) {
      const value = argument.slice('--only='.length);
      if (value === '') throw new Error('--only requires a case name.');
      if (onlyCaseName !== undefined) throw new Error('--only may be specified only once.');
      onlyCaseName = value;
      continue;
    }

    throw new Error(`Unknown argument: ${argument}`);
  }

  if (onlyCaseName !== undefined && !caseNames.has(onlyCaseName)) {
    throw new Error(
      `Unknown case: ${onlyCaseName}\nAvailable cases:\n${[...caseNames]
        .map((caseName) => `  - ${caseName}`)
        .join('\n')}`,
    );
  }

  return { dryRun, onlyCaseName };
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function createChatCompletionsUrl(baseUrl) {
  return `${baseUrl.replace(/\/+$/u, '')}/chat/completions`;
}

function createShortBody(model, overrides = {}) {
  return {
    model,
    messages: [{ role: 'user', content: 'Reply with exactly OK.' }],
    max_tokens: 16,
    reasoning_effort: 'none',
    ...overrides,
  };
}

function createCaseResult(status, observation) {
  return { status, observation };
}

function classifyHttpFailure(results) {
  const rejectedResult = results.find((result) => result.httpStatus === 400);
  if (rejectedResult !== undefined) {
    return createCaseResult(
      STATUS.rejected,
      `${rejectedResult.label} returned HTTP 400: ${summarizeErrorBody(rejectedResult.errorBody)}`,
    );
  }

  const malformedSuccess = results.find(
    (result) => result.httpStatus === 200 && result.errorBody !== undefined,
  );
  if (malformedSuccess !== undefined) {
    return createCaseResult(
      STATUS.unverifiable,
      `${malformedSuccess.label} returned an unusable HTTP 200 response: ${summarizeErrorBody(malformedSuccess.errorBody)}`,
    );
  }

  const failedResult = results.find((result) => result.httpStatus !== 200);
  if (failedResult !== undefined) {
    return createCaseResult(
      STATUS.unverifiable,
      `${failedResult.label} returned HTTP ${failedResult.httpStatus ?? 'unavailable'}`,
    );
  }

  return undefined;
}

function summarizeErrorBody(errorBody) {
  if (errorBody === undefined) return '(body absent)';
  const normalized = String(errorBody).replace(/\s+/gu, ' ').trim();
  return normalized.length <= 180 ? normalized : `${normalized.slice(0, 177)}...`;
}

function readNestedNumber(value, path) {
  let current = value;
  for (const pathPart of path) {
    if (!isRecord(current)) return undefined;
    current = current[pathPart];
  }
  return typeof current === 'number' ? current : undefined;
}

function readCompletionTokens(result) {
  return readNestedNumber(result.responseJson, ['usage', 'completion_tokens']);
}

function readReasoningTokens(result) {
  const chatCompletionsValue = readNestedNumber(result.responseJson, [
    'usage',
    'completion_tokens_details',
    'reasoning_tokens',
  ]);
  if (chatCompletionsValue !== undefined) return chatCompletionsValue;

  return readNestedNumber(result.responseJson, [
    'usage',
    'output_tokens_details',
    'reasoning_tokens',
  ]);
}

function readCacheToken(result, fieldName) {
  const value = readNestedNumber(result.responseJson, [
    'usage',
    'prompt_tokens_details',
    fieldName,
  ]);
  if (value !== undefined) return value;

  if (fieldName !== 'cache_write_tokens') return undefined;
  return readNestedNumber(result.responseJson, [
    'usage',
    'prompt_tokens_details',
    'cache_creation_tokens',
  ]);
}

function readFirstChoice(result) {
  const choices = result.responseJson?.choices;
  return Array.isArray(choices) && isRecord(choices[0]) ? choices[0] : undefined;
}

function readFinishReason(result) {
  const choice = readFirstChoice(result);
  return typeof choice?.finish_reason === 'string' ? choice.finish_reason : undefined;
}

function readMessage(result) {
  const choice = readFirstChoice(result);
  return isRecord(choice?.message) ? choice.message : undefined;
}

function readContent(result) {
  if (result.streamingResponse === true) return result.streamContent;
  const message = readMessage(result);
  return typeof message?.content === 'string' ? message.content : undefined;
}

function readResponseServiceTier(result) {
  const value = result.responseJson?.service_tier;
  return typeof value === 'string' ? value : undefined;
}

function wordCount(value) {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized === '' ? 0 : normalized.split(/\s+/u).length;
}

function estimateCaseCost(probeCase, model) {
  const price = MODEL_PRICES[model];
  return (
    (probeCase.estimatedTokens.input * price.input +
      probeCase.estimatedTokens.output * price.output) /
    1_000_000
  );
}

function createProbeCases(model, runNamespace) {
  const promptCacheKey = `rlgp-field-probe:cache:${runNamespace}`;
  const cacheSystemMessage = {
    role: 'system',
    content: [
      {
        type: 'text',
        text: CACHE_PREFIX_TEXT,
        prompt_cache_breakpoint: { mode: 'explicit' },
      },
    ],
  };

  return [
    {
      name: 'active-max-tokens',
      kind: 'active',
      // 예상 비용: Luna ~$0.0001 / Sol ~$0.0007.
      estimatedTokens: { input: 40, output: 16 },
      requests: [
        {
          label: 'max_tokens=16',
          body: createShortBody(model, {
            messages: [
              {
                role: 'user',
                content:
                  'Write a numbered list of one hundred distinct English nouns. Do not stop early.',
              },
            ],
            max_tokens: 16,
          }),
        },
      ],
      evaluate(results) {
        const failure = classifyHttpFailure(results);
        if (failure !== undefined) return failure;
        const completionTokens = readCompletionTokens(results[0]);
        const finishReason = readFinishReason(results[0]);
        if (finishReason === 'length' && completionTokens !== undefined && completionTokens <= 16) {
          return createCaseResult(
            STATUS.verified,
            `finish_reason=length, completion_tokens=${completionTokens}`,
          );
        }
        return createCaseResult(
          STATUS.unverifiable,
          `finish_reason=${finishReason ?? 'absent'}, completion_tokens=${completionTokens ?? 'absent'}`,
        );
      },
    },
    {
      name: 'active-reasoning-effort',
      kind: 'active',
      // 예상 비용: Luna ~$0.0013 / Sol ~$0.0064. none·top-level high·nested high 3회.
      estimatedTokens: { input: 120, output: 192 },
      requests: [
        {
          label: 'reasoning_effort=none',
          body: createShortBody(model, {
            messages: [
              {
                role: 'user',
                content: 'Compute 17 multiplied by 23. Reply with only the integer.',
              },
            ],
            max_tokens: 64,
            reasoning_effort: 'none',
          }),
        },
        {
          label: 'reasoning_effort=high',
          body: createShortBody(model, {
            messages: [
              {
                role: 'user',
                content: 'Compute 17 multiplied by 23. Reply with only the integer.',
              },
            ],
            max_tokens: 64,
            reasoning_effort: 'high',
          }),
        },
        {
          label: 'reasoning.effort=high',
          body: {
            model,
            messages: [
              {
                role: 'user',
                content: 'Compute 17 multiplied by 23. Reply with only the integer.',
              },
            ],
            max_tokens: 64,
            reasoning: { effort: 'high' },
          },
        },
      ],
      evaluate(results) {
        const failure = classifyHttpFailure(results);
        if (failure !== undefined) return failure;
        const noneTokens = readReasoningTokens(results[0]);
        const topLevelHighTokens = readReasoningTokens(results[1]);
        const nestedHighTokens = readReasoningTokens(results[2]);
        if (
          noneTokens !== undefined &&
          topLevelHighTokens !== undefined &&
          nestedHighTokens !== undefined &&
          topLevelHighTokens > noneTokens &&
          nestedHighTokens > noneTokens
        ) {
          return createCaseResult(
            STATUS.verified,
            `reasoning_tokens none/top/nested=${noneTokens}/${topLevelHighTokens}/${nestedHighTokens}`,
          );
        }
        return createCaseResult(
          STATUS.unverifiable,
          `reasoning_tokens none/top/nested=${noneTokens ?? 'absent'}/${topLevelHighTokens ?? 'absent'}/${nestedHighTokens ?? 'absent'}`,
        );
      },
    },
    {
      name: 'active-verbosity',
      kind: 'active',
      // 예상 비용: Luna ~$0.0009 / Sol ~$0.0043. 출력 길이는 확률적 신호라 판정 불가가 가능하다.
      estimatedTokens: { input: 100, output: 128 },
      requests: [
        {
          label: 'verbosity=low',
          body: createShortBody(model, {
            messages: [
              { role: 'user', content: 'Explain in plain English why Earth has seasons.' },
            ],
            max_tokens: 64,
            verbosity: 'low',
          }),
        },
        {
          label: 'verbosity=high',
          body: createShortBody(model, {
            messages: [
              { role: 'user', content: 'Explain in plain English why Earth has seasons.' },
            ],
            max_tokens: 64,
            verbosity: 'high',
          }),
        },
      ],
      evaluate(results) {
        const failure = classifyHttpFailure(results);
        if (failure !== undefined) return failure;
        const lowTokens = readCompletionTokens(results[0]);
        const highTokens = readCompletionTokens(results[1]);
        const lowCharacters = readContent(results[0])?.length;
        const highCharacters = readContent(results[1])?.length;
        const tokenSignal =
          lowTokens !== undefined && highTokens !== undefined && highTokens >= lowTokens + 5;
        const characterSignal =
          lowCharacters !== undefined &&
          highCharacters !== undefined &&
          highCharacters >= lowCharacters * 1.25;
        if (tokenSignal || characterSignal) {
          return createCaseResult(
            STATUS.verified,
            `completion_tokens low/high=${lowTokens ?? 'absent'}/${highTokens ?? 'absent'}, characters=${lowCharacters ?? 'absent'}/${highCharacters ?? 'absent'}`,
          );
        }
        return createCaseResult(
          STATUS.unverifiable,
          `no clear length separation; tokens=${lowTokens ?? 'absent'}/${highTokens ?? 'absent'}, characters=${lowCharacters ?? 'absent'}/${highCharacters ?? 'absent'}`,
        );
      },
    },
    {
      name: 'active-response-format-json-object',
      kind: 'active',
      // 예상 비용: Luna ~$0.0003 / Sol ~$0.0013.
      estimatedTokens: { input: 60, output: 32 },
      requests: [
        {
          label: 'response_format=json_object',
          body: createShortBody(model, {
            messages: [
              {
                role: 'user',
                content: 'Return one JSON object with the exact property and value {"probe":"ok"}.',
              },
            ],
            max_tokens: 32,
            response_format: { type: 'json_object' },
          }),
        },
      ],
      evaluate(results) {
        const failure = classifyHttpFailure(results);
        if (failure !== undefined) return failure;
        const content = readContent(results[0]);
        if (content === undefined) {
          return createCaseResult(STATUS.unverifiable, 'assistant content is absent');
        }
        try {
          const parsedContent = JSON.parse(content);
          if (isRecord(parsedContent) && parsedContent.probe === 'ok') {
            return createCaseResult(STATUS.verified, `parsed JSON content=${content}`);
          }
          return createCaseResult(
            STATUS.unverifiable,
            `JSON parsed but probe was not "ok": ${content}`,
          );
        } catch (error) {
          return createCaseResult(
            STATUS.unverifiable,
            `assistant content was not JSON: ${describeError(error)}`,
          );
        }
      },
    },
    {
      name: 'active-tools',
      kind: 'active',
      // 예상 비용: Luna ~$0.0005 / Sol ~$0.0025. tool schema 입력을 보수적으로 계산.
      estimatedTokens: { input: 220, output: 48 },
      requests: [
        {
          label: 'forced function tool',
          body: createShortBody(model, {
            messages: [{ role: 'user', content: 'Record the probe value ok.' }],
            max_tokens: 48,
            tools: [
              {
                type: 'function',
                function: {
                  name: 'record_probe',
                  description: 'Record the hosted request-field probe result.',
                  parameters: {
                    type: 'object',
                    properties: { value: { type: 'string', enum: ['ok'] } },
                    required: ['value'],
                    additionalProperties: false,
                  },
                },
              },
            ],
            tool_choice: { type: 'function', function: { name: 'record_probe' } },
          }),
        },
      ],
      evaluate(results) {
        const failure = classifyHttpFailure(results);
        if (failure !== undefined) return failure;
        const message = readMessage(results[0]);
        const toolCalls = message?.tool_calls;
        const firstToolCall =
          Array.isArray(toolCalls) && isRecord(toolCalls[0]) ? toolCalls[0] : undefined;
        const functionCall = isRecord(firstToolCall?.function) ? firstToolCall.function : undefined;
        if (functionCall?.name === 'record_probe') {
          return createCaseResult(
            STATUS.verified,
            `finish_reason=${readFinishReason(results[0]) ?? 'absent'}, tool_call=record_probe`,
          );
        }
        return createCaseResult(
          STATUS.unverifiable,
          `finish_reason=${readFinishReason(results[0]) ?? 'absent'}, record_probe tool_call absent`,
        );
      },
    },
    {
      name: 'active-prompt-cache',
      kind: 'active',
      // 예상 비용: Luna ~$0.0038 / Sol ~$0.0190. 1,024-token 최소 때문에 이 케이스만 큰 입력을 쓴다.
      estimatedTokens: { input: 3_600, output: 32 },
      requests: [
        {
          label: 'explicit cache write',
          body: {
            model,
            messages: [cacheSystemMessage, { role: 'user', content: 'Reply with exactly WRITE.' }],
            max_tokens: 16,
            reasoning_effort: 'none',
            prompt_cache_key: promptCacheKey,
            prompt_cache_options: { mode: 'explicit', ttl: '30m' },
          },
        },
        {
          label: 'explicit cache read',
          body: {
            model,
            messages: [cacheSystemMessage, { role: 'user', content: 'Reply with exactly READ.' }],
            max_tokens: 16,
            reasoning_effort: 'none',
            prompt_cache_key: promptCacheKey,
            prompt_cache_options: { mode: 'explicit', ttl: '30m' },
          },
        },
      ],
      evaluate(results) {
        const failure = classifyHttpFailure(results);
        if (failure !== undefined) return failure;
        const writeTokens = readCacheToken(results[0], 'cache_write_tokens');
        const cachedTokens = readCacheToken(results[1], 'cached_tokens');
        if (cachedTokens !== undefined && cachedTokens > 0) {
          return createCaseResult(
            STATUS.verified,
            `cache_write_tokens=${writeTokens ?? 'absent'}, second cached_tokens=${cachedTokens}`,
          );
        }
        return createCaseResult(
          STATUS.unverifiable,
          `cache_write_tokens=${writeTokens ?? 'absent'}, second cached_tokens=${cachedTokens ?? 'absent'}`,
        );
      },
    },
    {
      name: 'active-service-tier-flex',
      kind: 'active',
      // 예상 비용: Luna ~$0.0001 / Sol ~$0.0007. flex 할인은 계산에서 제외해 보수적이다.
      estimatedTokens: { input: 40, output: 16 },
      requests: [
        {
          label: 'service_tier=flex',
          body: createShortBody(model, { service_tier: 'flex' }),
        },
      ],
      evaluate(results) {
        const failure = classifyHttpFailure(results);
        if (failure !== undefined) return failure;
        const responseServiceTier = readResponseServiceTier(results[0]);
        return responseServiceTier === 'flex'
          ? createCaseResult(STATUS.verified, 'response service_tier=flex')
          : createCaseResult(
              STATUS.unverifiable,
              `response service_tier=${responseServiceTier ?? 'absent'}`,
            );
      },
    },
    {
      name: 'drop-max-completion-tokens',
      kind: 'drop',
      // 예상 비용: Luna ~$0.0003 / Sol ~$0.0016. 정확히 24개 단어로 무제한 출력을 제한한다.
      estimatedTokens: { input: 80, output: 40 },
      requests: [
        {
          label: 'max_completion_tokens=16 only',
          body: {
            model,
            messages: [
              {
                role: 'user',
                content:
                  'Output exactly these words and nothing else: one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twenty-one twenty-two twenty-three twenty-four',
              },
            ],
            max_completion_tokens: 16,
            reasoning_effort: 'none',
          },
        },
      ],
      evaluate(results) {
        const failure = classifyHttpFailure(results);
        if (failure !== undefined) return failure;
        const completionTokens = readCompletionTokens(results[0]);
        const finishReason = readFinishReason(results[0]);
        const outputWords = wordCount(readContent(results[0]));
        if (
          (completionTokens !== undefined && completionTokens > 16 && finishReason !== 'length') ||
          (outputWords !== undefined && outputWords >= 20 && finishReason !== 'length')
        ) {
          return createCaseResult(
            STATUS.dropped,
            `finish_reason=${finishReason ?? 'absent'}, completion_tokens=${completionTokens ?? 'absent'}, words=${outputWords}`,
          );
        }
        if (finishReason === 'length' && completionTokens !== undefined && completionTokens <= 16) {
          return createCaseResult(
            STATUS.verified,
            `field unexpectedly worked: finish_reason=length, completion_tokens=${completionTokens}`,
          );
        }
        return createCaseResult(
          STATUS.unverifiable,
          `finish_reason=${finishReason ?? 'absent'}, completion_tokens=${completionTokens ?? 'absent'}, words=${outputWords ?? 'absent'}`,
        );
      },
    },
    {
      name: 'drop-stream-options',
      kind: 'drop',
      // 예상 비용: Luna ~$0.0001 / Sol ~$0.0007. include_usage:false가 제거되면 Gateway 자체 usage chunk가 보인다.
      estimatedTokens: { input: 40, output: 16 },
      requests: [
        {
          label: 'stream_options.include_usage=false',
          transport: 'sse',
          body: createShortBody(model, {
            stream: true,
            stream_options: { include_usage: false },
          }),
        },
      ],
      evaluate(results) {
        const failure = classifyHttpFailure(results);
        if (failure !== undefined) return failure;
        if (isRecord(results[0].streamUsage)) {
          return createCaseResult(
            STATUS.dropped,
            'final SSE usage chunk is present despite include_usage=false',
          );
        }
        if (results[0].sseDone === true && results[0].sseParseErrors.length === 0) {
          return createCaseResult(
            STATUS.verified,
            'no final SSE usage chunk; include_usage=false was honored',
          );
        }
        return createCaseResult(
          STATUS.unverifiable,
          `usage chunk absent, done=${results[0].sseDone}, parse_errors=${results[0].sseParseErrors.length}`,
        );
      },
    },
    {
      name: 'drop-stop',
      kind: 'drop',
      // 예상 비용: Luna ~$0.0001 / Sol ~$0.0007.
      estimatedTokens: { input: 40, output: 16 },
      requests: [
        {
          label: 'stop=HALT',
          body: createShortBody(model, {
            messages: [{ role: 'user', content: 'Output exactly: ALPHA HALT OMEGA' }],
            max_tokens: 16,
            stop: 'HALT',
          }),
        },
      ],
      evaluate(results) {
        const failure = classifyHttpFailure(results);
        if (failure !== undefined) return failure;
        const content = readContent(results[0]);
        const finishReason = readFinishReason(results[0]);
        if (content?.includes('HALT') && content.includes('OMEGA')) {
          return createCaseResult(
            STATUS.dropped,
            `output preserved stop sequence: ${JSON.stringify(content)}`,
          );
        }
        if (finishReason === 'stop' && content !== undefined && !content.includes('HALT')) {
          return createCaseResult(
            STATUS.verified,
            `stop sequence removed; output=${JSON.stringify(content)}`,
          );
        }
        return createCaseResult(
          STATUS.unverifiable,
          `finish_reason=${finishReason ?? 'absent'}, output=${JSON.stringify(content)}`,
        );
      },
    },
    {
      name: 'drop-seed',
      kind: 'drop',
      // 예상 비용: Luna ~$0.0001 / Sol ~$0.0006. 잘못된 타입이 200이면 ingress 제거를 확정할 수 있다.
      estimatedTokens: { input: 30, output: 16 },
      requests: [
        {
          label: 'seed=invalid-string-sentinel',
          body: createShortBody(model, { seed: 'invalid-string-sentinel' }),
        },
      ],
      evaluate(results) {
        const failure = classifyHttpFailure(results);
        if (failure !== undefined) return failure;
        return createCaseResult(STATUS.dropped, 'invalid seed type returned HTTP 200');
      },
    },
    createExpectedRejectionCase({
      name: 'reject-reasoning-minimal',
      model,
      // 예상 비용: $0 (400 preflight/upstream rejection expected).
      body: createShortBody(model, { reasoning_effort: 'minimal' }),
    }),
    createExpectedRejectionCase({
      name: 'reject-n-multiple',
      model,
      // 예상 비용: $0 (Gateway capability 400 expected).
      body: createShortBody(model, { n: 2 }),
    }),
    createExpectedRejectionCase({
      name: 'reject-reasoning-max-tokens',
      model,
      // 예상 비용: $0 (Gateway capability 400 expected).
      body: {
        model,
        messages: [{ role: 'user', content: 'Reply with exactly OK.' }],
        max_tokens: 16,
        reasoning: { effort: 'low', max_tokens: 16 },
      },
    }),
    createExpectedRejectionCase({
      name: 'reject-reasoning-duplicate',
      model,
      // 예상 비용: $0 (mutually exclusive field validation 400 expected).
      body: {
        model,
        messages: [{ role: 'user', content: 'Reply with exactly OK.' }],
        max_tokens: 16,
        reasoning_effort: 'low',
        reasoning: { effort: 'high' },
      },
    }),
    createExpectedRejectionCase({
      name: 'reject-input-audio',
      model,
      // 예상 비용: $0 (GPT-5.6 input capability 400 expected).
      body: {
        model,
        messages: [
          {
            role: 'user',
            content: [{ type: 'input_audio', input_audio: { data: 'AA==', format: 'mp3' } }],
          },
        ],
        max_tokens: 16,
      },
    }),
    createExpectedRejectionCase({
      name: 'reject-file-part',
      model,
      // 예상 비용: $0 (GPT-5.6 document capability 400 expected).
      body: {
        model,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'file',
                file: {
                  filename: 'probe.txt',
                  file_data: 'data:text/plain;base64,T0s=',
                },
              },
            ],
          },
        ],
        max_tokens: 16,
      },
    }),
    createExpectedRejectionCase({
      name: 'reject-image-detail-original',
      model,
      // 예상 비용: $0 (Gateway ingress enum 400 expected).
      body: {
        model,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: { url: ONE_PIXEL_PNG_DATA_URL, detail: 'original' },
              },
              { type: 'text', text: 'Reply with exactly OK.' },
            ],
          },
        ],
        max_tokens: 16,
      },
    }),
    createExpectedRejectionCase({
      name: 'reject-max-tokens-over-limit',
      model,
      // 예상 비용: $0 (128k model limit 400 expected).
      body: createShortBody(model, { max_tokens: 128_001 }),
    }),
  ];
}

function createExpectedRejectionCase({ name, body }) {
  return {
    name,
    kind: 'reject',
    estimatedTokens: { input: 0, output: 0 },
    requests: [{ label: name, body }],
    evaluate(results) {
      const result = results[0];
      if (result.httpStatus === 400) {
        return createCaseResult(
          STATUS.rejected,
          `HTTP 400: ${summarizeErrorBody(result.errorBody)}`,
        );
      }
      return createCaseResult(
        STATUS.unverifiable,
        `expected HTTP 400, observed HTTP ${result.httpStatus ?? 'unavailable'}`,
      );
    },
  };
}

function parseSseResponse(responseBody) {
  const events = [];
  const parseErrors = [];
  let done = false;

  for (const line of responseBody.split(/\r?\n/u)) {
    if (!line.startsWith('data:')) continue;
    const data = line.slice('data:'.length).trim();
    if (data === '[DONE]') {
      done = true;
      continue;
    }
    if (data === '') continue;

    try {
      events.push(JSON.parse(data));
    } catch (error) {
      parseErrors.push(`${describeError(error)}: ${data}`);
    }
  }

  const content = events
    .map((event) => {
      const choices = isRecord(event) ? event.choices : undefined;
      const choice = Array.isArray(choices) && isRecord(choices[0]) ? choices[0] : undefined;
      const delta = isRecord(choice?.delta) ? choice.delta : undefined;
      return typeof delta?.content === 'string' ? delta.content : '';
    })
    .join('');
  const usageEvent = events.findLast((event) => isRecord(event) && isRecord(event.usage));
  const finishEvent = events.findLast((event) => {
    const choices = isRecord(event) ? event.choices : undefined;
    const choice = Array.isArray(choices) && isRecord(choices[0]) ? choices[0] : undefined;
    return typeof choice?.finish_reason === 'string';
  });
  const finishChoices = isRecord(finishEvent) ? finishEvent.choices : undefined;
  const finishChoice =
    Array.isArray(finishChoices) && isRecord(finishChoices[0]) ? finishChoices[0] : undefined;

  return {
    content,
    done,
    events,
    finishReason:
      typeof finishChoice?.finish_reason === 'string' ? finishChoice.finish_reason : undefined,
    parseErrors,
    usage: isRecord(usageEvent) ? usageEvent.usage : undefined,
  };
}

async function runRequest({ apiKey, baseUrl, probeCase, request }) {
  const startedAt = Date.now();
  try {
    const response = await fetch(createChatCompletionsUrl(baseUrl), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request.body),
    });
    const responseBody = await response.text();
    const commonResult = {
      caseName: probeCase.name,
      label: request.label,
      httpStatus: response.status,
      elapsedMilliseconds: Date.now() - startedAt,
    };

    if (!response.ok) return { ...commonResult, errorBody: responseBody };

    if (request.transport === 'sse') {
      const stream = parseSseResponse(responseBody);
      return {
        ...commonResult,
        streamingResponse: true,
        streamContent: stream.content,
        streamFinishReason: stream.finishReason,
        streamUsage: stream.usage,
        sseDone: stream.done,
        sseEventCount: stream.events.length,
        sseParseErrors: stream.parseErrors,
      };
    }

    try {
      return { ...commonResult, responseJson: JSON.parse(responseBody) };
    } catch (error) {
      return {
        ...commonResult,
        errorBody: `HTTP 200 response was not JSON (${describeError(error)}): ${responseBody}`,
      };
    }
  } catch (error) {
    return {
      caseName: probeCase.name,
      label: request.label,
      httpStatus: undefined,
      elapsedMilliseconds: Date.now() - startedAt,
      errorBody: describeError(error),
    };
  }
}

function formatJson(value) {
  return value === undefined ? '(absent)' : JSON.stringify(value, null, 2);
}

function printRequestResult(result) {
  writeLine();
  writeLine(`=== ${result.caseName} :: ${result.label} ===`);
  writeLine(`HTTP status: ${result.httpStatus ?? '(unavailable)'}`);
  writeLine(`elapsed: ${result.elapsedMilliseconds} ms`);

  if (result.errorBody !== undefined) {
    writeLine('error body:');
    writeLine(result.errorBody);
    return;
  }

  if (result.streamingResponse === true) {
    writeLine(`SSE events: ${result.sseEventCount}; done: ${result.sseDone}`);
    writeLine(`finish_reason: ${result.streamFinishReason ?? '(absent)'}`);
    writeLine(`content: ${JSON.stringify(result.streamContent)}`);
    writeLine('usage:');
    writeLine(formatJson(result.streamUsage));
    if (result.sseParseErrors.length > 0) {
      writeLine('SSE parse errors:');
      writeLine(formatJson(result.sseParseErrors));
    }
    return;
  }

  writeLine(`finish_reason: ${readFinishReason(result) ?? '(absent)'}`);
  writeLine(`content: ${JSON.stringify(readContent(result))}`);
  writeLine('usage:');
  writeLine(formatJson(result.responseJson?.usage));
  writeLine(`response service_tier: ${readResponseServiceTier(result) ?? '(absent)'}`);
}

function sleep(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function splitTableCell(value) {
  return String(value).split(/\r?\n/u);
}

function printSummaryRows(rows) {
  const headings = ['case', 'kind', 'status', 'observation'];
  const headingRow = Object.fromEntries(headings.map((heading) => [heading, heading]));
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
    return Array.from(
      { length: rowHeight },
      (_, lineIndex) =>
        `| ${cells
          .map((cell, columnIndex) => (cell[lineIndex] ?? '').padEnd(widths[columnIndex]))
          .join(' | ')} |`,
    ).join('\n');
  };

  writeLine();
  writeLine('=== Hosted field probe summary ===');
  writeLine(renderRow(headingRow));
  writeLine(`|-${widths.map((width) => '-'.repeat(width)).join('-|-')}-|`);
  rows.forEach((row) => writeLine(renderRow(row)));
}

function printExecutionEstimate(probeCases, model) {
  const totalRequests = probeCases.reduce(
    (requestCount, probeCase) => requestCount + probeCase.requests.length,
    0,
  );
  const estimatedCost = probeCases.reduce(
    (cost, probeCase) => cost + estimateCaseCost(probeCase, model),
    0,
  );
  const prices = MODEL_PRICES[model];

  writeLine('=== Probe execution estimate ===');
  writeLine(`model: ${model}`);
  writeLine(`requests: ${totalRequests}`);
  writeLine(`price basis: input $${prices.input}/1M, output $${prices.output}/1M`);
  writeLine(`estimated total: $${estimatedCost.toFixed(4)} (HTTP 400 cases assumed unbilled)`);
  for (const probeCase of probeCases) {
    writeLine(
      `- ${probeCase.name}: ${probeCase.requests.length} request(s), ~$${estimateCaseCost(probeCase, model).toFixed(4)}`,
    );
  }
}

function printDryRun(probeCases) {
  const requestBodies = Object.fromEntries(
    probeCases.map((probeCase) => [
      probeCase.name,
      probeCase.requests.map((request) => request.body),
    ]),
  );
  writeLine(JSON.stringify(requestBodies, null, 2));
}

async function main() {
  const model = readEnvironmentVariable('PROBE_MODEL', DEFAULT_MODEL);
  if (!ALLOWED_MODELS.has(model)) {
    throw new Error(`PROBE_MODEL must be one of: ${[...ALLOWED_MODELS].join(', ')}`);
  }
  const baseUrl = readEnvironmentVariable('PROBE_BASE_URL', DEFAULT_BASE_URL);
  const runNamespace = Date.now().toString(36);
  const allProbeCases = createProbeCases(model, runNamespace);
  const caseNames = new Set(allProbeCases.map((probeCase) => probeCase.name));
  const { dryRun, onlyCaseName } = parseArguments(caseNames);
  const selectedCases =
    onlyCaseName === undefined
      ? allProbeCases
      : allProbeCases.filter((probeCase) => probeCase.name === onlyCaseName);

  if (dryRun) {
    printDryRun(selectedCases);
    return;
  }

  const apiKey = readApiKey();
  printExecutionEstimate(selectedCases, model);
  writeLine(`base URL: ${baseUrl}`);
  writeLine();
  writeLine('⚠️ Live billable probe started because --dry-run was not supplied.');

  const summaryRows = [];
  let completedRequestCount = 0;
  const totalRequestCount = selectedCases.reduce(
    (requestCount, probeCase) => requestCount + probeCase.requests.length,
    0,
  );

  for (const probeCase of selectedCases) {
    const results = [];
    for (const request of probeCase.requests) {
      const result = await runRequest({ apiKey, baseUrl, probeCase, request });
      results.push(result);
      printRequestResult(result);
      completedRequestCount += 1;
      if (completedRequestCount < totalRequestCount) await sleep(REQUEST_DELAY_MILLISECONDS);
    }

    const verdict = probeCase.evaluate(results);
    summaryRows.push({
      case: probeCase.name,
      kind: probeCase.kind,
      status: verdict.status,
      observation: verdict.observation,
    });
  }

  printSummaryRows(summaryRows);
}

void main().catch((error) => {
  writeErrorLine(describeError(error));
  process.exitCode = 1;
});
