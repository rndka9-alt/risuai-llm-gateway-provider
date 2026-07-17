import { createHash } from 'node:crypto';
import type { JsonObject, JsonValue } from 'llm-io';

export type FakeGatewayKernelPreset = 'calibrated' | 'pessimistic' | 'optimistic';
export type CacheWindowScope = 'per-key' | 'global';
export type MarkerMatchMode = 'exact' | 'partial-prefix';
export type KernelTokenizer = (text: string) => number;

export interface FakeGatewayKernelOptions {
  hardExpiry: boolean;
  infiniteTtl: boolean;
  markerMatchMode: MarkerMatchMode;
  maximumPromptCacheKeyLength: number;
  minimumCacheablePrefixTokens: number;
  postMinimumSurvivalProbability: number;
  refreshTtlOnRead: boolean;
  tokenizer: KernelTokenizer;
  ttlMinutes: number;
  windowScope: CacheWindowScope;
  windowSize: number;
}

export interface FakeGatewayRequest {
  atMinute: number;
  promptCacheKey: string;
  requestBody: JsonObject;
}

export interface FakeGatewayAccounting {
  inputTokens: number;
  markerPrefixTokens: readonly number[];
  readTokens: number;
  wireMarkerCount: number;
  wireMarkerRoles: readonly string[];
  writeTokens: number;
}

interface WirePrompt {
  fullPrompt: string;
  markerPrefixes: readonly string[];
  markerRoles: readonly string[];
}

interface CacheEntry {
  createdAtMinute: number;
  lastReadAtMinute: number | null;
  prefix: string;
  prefixTokens: number;
  promptCacheKey: string;
  sequence: number;
}

const DEFAULT_KERNEL_TOKENIZER: KernelTokenizer = (text) => Math.ceil(text.length / 4);

// TTL 실측(probe --ttl, 2026-07): 29분 hit / 31·45·60분 miss로 무접근 시 30분
// 하드 만료가 확인됐고, 25분 hit 후 45분 hit로 히트 시 수명 갱신이 확인됐다.
const CALIBRATED_OPTIONS: FakeGatewayKernelOptions = {
  hardExpiry: true,
  infiniteTtl: false,
  markerMatchMode: 'exact',
  maximumPromptCacheKeyLength: 64,
  minimumCacheablePrefixTokens: 1024,
  postMinimumSurvivalProbability: 0,
  refreshTtlOnRead: true,
  tokenizer: DEFAULT_KERNEL_TOKENIZER,
  ttlMinutes: 30,
  windowScope: 'per-key',
  windowSize: 50,
};

const PESSIMISTIC_OPTIONS: FakeGatewayKernelOptions = {
  ...CALIBRATED_OPTIONS,
  hardExpiry: true,
  postMinimumSurvivalProbability: 0,
  // 히트 갱신은 실측으로 확인됐지만, 비관 커널은 갱신이 없는 세계도 계속 커버한다.
  refreshTtlOnRead: false,
  windowScope: 'global',
};

const OPTIMISTIC_OPTIONS: FakeGatewayKernelOptions = {
  ...CALIBRATED_OPTIONS,
  infiniteTtl: true,
  markerMatchMode: 'partial-prefix',
  postMinimumSurvivalProbability: 1,
};

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function appendTextPart(
  part: JsonObject,
  prompt: string,
): { markerPresent: boolean; prompt: string } {
  const type = part.type;
  const text = part.text;
  if (type === 'text' && typeof text === 'string') {
    return {
      markerPresent: part.prompt_cache_breakpoint !== undefined,
      prompt: `${prompt}\u241etext:${text}`,
    };
  }

  const partWithoutMarker: JsonObject = {};
  Object.entries(part).forEach(([key, value]) => {
    if (key !== 'prompt_cache_breakpoint') partWithoutMarker[key] = value;
  });
  return {
    markerPresent: part.prompt_cache_breakpoint !== undefined,
    prompt: `${prompt}\u241epart:${JSON.stringify(partWithoutMarker)}`,
  };
}

function createWirePrompt(requestBody: JsonObject): WirePrompt {
  const messages = requestBody.messages;
  if (!Array.isArray(messages)) {
    throw new Error('Serialized Chat Completions body must contain a messages array.');
  }

  let prompt = '';
  const markerPrefixes: string[] = [];
  const markerRoles: string[] = [];
  messages.forEach((messageValue, messageIndex) => {
    if (!isJsonObject(messageValue)) {
      throw new Error(`Serialized message ${messageIndex} is not an object.`);
    }
    const role = messageValue.role;
    if (typeof role !== 'string') {
      throw new Error(`Serialized message ${messageIndex} has no string role.`);
    }
    prompt += `\u241frole:${role}`;

    const content = messageValue.content;
    if (typeof content === 'string') {
      prompt += `\u241etext:${content}`;
    } else if (Array.isArray(content)) {
      content.forEach((partValue, partIndex) => {
        if (!isJsonObject(partValue)) {
          throw new Error(
            `Serialized message ${messageIndex} content part ${partIndex} is not an object.`,
          );
        }
        const appended = appendTextPart(partValue, prompt);
        prompt = appended.prompt;
        if (appended.markerPresent) {
          markerPrefixes.push(prompt);
          markerRoles.push(role);
        }
      });
    } else {
      prompt += `\u241econtent:${JSON.stringify(content)}`;
    }
    prompt += '\u241dmessage-end';
  });

  return { fullPrompt: prompt, markerPrefixes, markerRoles };
}

function commonPrefix(left: string, right: string): string {
  const maximumLength = Math.min(left.length, right.length);
  let length = 0;
  while (length < maximumLength && left.charCodeAt(length) === right.charCodeAt(length)) {
    length += 1;
  }
  return left.slice(0, length);
}

function deterministicUnitInterval(value: string): number {
  const hashPrefix = createHash('sha256').update(value).digest('hex').slice(0, 8);
  return Number.parseInt(hashPrefix, 16) / 0xffffffff;
}

function optionsForPreset(preset: FakeGatewayKernelPreset): FakeGatewayKernelOptions {
  if (preset === 'calibrated') return CALIBRATED_OPTIONS;
  if (preset === 'pessimistic') return PESSIMISTIC_OPTIONS;
  return OPTIMISTIC_OPTIONS;
}

// planner는 ASCII/4 + 비ASCII/2를 사용하지만 gateway kernel은 의도적으로
// 고정 문자수/4 tokenizer를 쓴다. 두 추정기를 공유하면 1024-token guard의
// 오판을 시뮬레이터가 스스로 숨기는 순환 검증이 된다.
export class FakeGatewayKernel {
  readonly name: FakeGatewayKernelPreset;
  readonly options: FakeGatewayKernelOptions;
  private readonly entries: CacheEntry[] = [];
  private lastRequestMinute = 0;
  private nextSequence = 0;

  constructor(preset: FakeGatewayKernelPreset, overrides: Partial<FakeGatewayKernelOptions> = {}) {
    this.name = preset;
    this.options = { ...optionsForPreset(preset), ...overrides };
    if (
      this.options.postMinimumSurvivalProbability < 0 ||
      this.options.postMinimumSurvivalProbability > 1
    ) {
      throw new RangeError('postMinimumSurvivalProbability must be between 0 and 1.');
    }
  }

  process(request: FakeGatewayRequest): FakeGatewayAccounting {
    if (request.atMinute < this.lastRequestMinute) {
      throw new Error('Fake gateway request time must be monotonic.');
    }
    this.lastRequestMinute = request.atMinute;
    if (request.promptCacheKey.length > this.options.maximumPromptCacheKeyLength) {
      throw new RangeError(
        `prompt_cache_key exceeds ${this.options.maximumPromptCacheKeyLength} characters.`,
      );
    }

    const wirePrompt = createWirePrompt(request.requestBody);
    const inputTokens = this.options.tokenizer(wirePrompt.fullPrompt);
    const markerPrefixTokens = wirePrompt.markerPrefixes.map(this.options.tokenizer);
    if (wirePrompt.markerPrefixes.length === 0) {
      return {
        inputTokens,
        markerPrefixTokens,
        readTokens: 0,
        wireMarkerCount: 0,
        wireMarkerRoles: [],
        writeTokens: 0,
      };
    }

    const deepestMarkerIndex = markerPrefixTokens.reduce(
      (deepestIndex, tokenCount, markerIndex) =>
        tokenCount >= markerPrefixTokens[deepestIndex] ? markerIndex : deepestIndex,
      0,
    );
    const deepestPrefix = wirePrompt.markerPrefixes[deepestMarkerIndex];
    const deepestPrefixTokens = markerPrefixTokens[deepestMarkerIndex];
    if (deepestPrefixTokens < this.options.minimumCacheablePrefixTokens) {
      return {
        inputTokens,
        markerPrefixTokens,
        readTokens: 0,
        wireMarkerCount: wirePrompt.markerPrefixes.length,
        wireMarkerRoles: wirePrompt.markerRoles,
        writeTokens: 0,
      };
    }

    const candidates = this.searchWindow(request.promptCacheKey).filter((entry) =>
      this.isAlive(entry, request.atMinute),
    );
    let selectedEntry: CacheEntry | null = null;
    let readTokens = 0;
    for (const entry of candidates) {
      const candidateReadTokens = this.readableTokens(
        entry,
        deepestPrefix,
        wirePrompt.markerPrefixes,
      );
      if (candidateReadTokens > readTokens) {
        selectedEntry = entry;
        readTokens = candidateReadTokens;
      }
    }

    if (selectedEntry !== null && this.options.refreshTtlOnRead) {
      selectedEntry.lastReadAtMinute = request.atMinute;
    }

    // Probe calibration fixed both contracts: nested breakpoints cost only their
    // deepest union, and an existing read is deducted before charging new growth.
    const writeTokens = Math.max(0, deepestPrefixTokens - readTokens);
    if (writeTokens > 0) {
      wirePrompt.markerPrefixes.forEach((prefix, markerIndex) => {
        const prefixTokens = markerPrefixTokens[markerIndex];
        if (
          prefixTokens >= this.options.minimumCacheablePrefixTokens &&
          prefixTokens > readTokens
        ) {
          this.entries.push({
            createdAtMinute: request.atMinute,
            lastReadAtMinute: null,
            prefix,
            prefixTokens,
            promptCacheKey: request.promptCacheKey,
            sequence: this.nextSequence,
          });
          this.nextSequence += 1;
        }
      });
    }

    return {
      inputTokens,
      markerPrefixTokens,
      readTokens,
      wireMarkerCount: wirePrompt.markerPrefixes.length,
      wireMarkerRoles: wirePrompt.markerRoles,
      writeTokens,
    };
  }

  private searchWindow(promptCacheKey: string): readonly CacheEntry[] {
    if (this.options.windowScope === 'per-key') {
      return this.entries
        .filter((entry) => entry.promptCacheKey === promptCacheKey)
        .slice(-this.options.windowSize);
    }
    return this.entries
      .slice(-this.options.windowSize)
      .filter((entry) => entry.promptCacheKey === promptCacheKey);
  }

  private isAlive(entry: CacheEntry, atMinute: number): boolean {
    if (this.options.infiniteTtl) return true;
    const lifetimeOrigin =
      this.options.refreshTtlOnRead && entry.lastReadAtMinute !== null
        ? entry.lastReadAtMinute
        : entry.createdAtMinute;
    const ageMinutes = atMinute - lifetimeOrigin;
    if (ageMinutes <= this.options.ttlMinutes) return true;
    if (this.options.hardExpiry) return false;

    const extraLifetimeIntervals = Math.ceil(
      (ageMinutes - this.options.ttlMinutes) / this.options.ttlMinutes,
    );
    for (let intervalIndex = 1; intervalIndex <= extraLifetimeIntervals; intervalIndex += 1) {
      const survives = deterministicUnitInterval(
        `${entry.promptCacheKey}:${entry.sequence}:${intervalIndex}`,
      );
      if (survives >= this.options.postMinimumSurvivalProbability) return false;
    }
    return true;
  }

  private readableTokens(
    entry: CacheEntry,
    deepestPrefix: string,
    currentMarkerPrefixes: readonly string[],
  ): number {
    if (this.options.markerMatchMode === 'exact') {
      return currentMarkerPrefixes.includes(entry.prefix) ? entry.prefixTokens : 0;
    }
    const sharedPrefix = commonPrefix(entry.prefix, deepestPrefix);
    const sharedTokens = this.options.tokenizer(sharedPrefix);
    return sharedTokens >= this.options.minimumCacheablePrefixTokens
      ? Math.min(sharedTokens, entry.prefixTokens)
      : 0;
  }
}

export function createFakeGatewayKernel(
  preset: FakeGatewayKernelPreset,
  overrides: Partial<FakeGatewayKernelOptions> = {},
): FakeGatewayKernel {
  return new FakeGatewayKernel(preset, overrides);
}
