import { maskSensitiveDeep } from './mask-sensitive-deep';

const MAX_BODY_CHARS = 20_000;

// 응답도 wire 구조를 보존하되 생성 텍스트 필드만 걷어낸다 — 실패 body엔 생성
// 텍스트가 없으므로 이 규칙 하나로 실패 진단 정보는 자동으로 온전히 남는다.
export function redactResponseBody(bodyText: string): string {
  if (bodyText === '') return '[본문 없음]';
  if (isSseBody(bodyText)) return truncateBody(redactSseBody(bodyText));
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    // JSON도 SSE도 아닌 본문(프록시 오류 페이지 등)은 생성 텍스트가 아니므로 그대로 남긴다.
    return truncateBody(bodyText);
  }
  return truncateBody(JSON.stringify(maskSensitiveDeep(redactCompletionContent(parsed)), null, 2));
}

function isSseBody(bodyText: string): boolean {
  const firstLine = bodyText.trimStart().split('\n', 1)[0] ?? '';
  return firstLine.startsWith('data:') || firstLine.startsWith('event:');
}

function redactCompletionContent(parsed: unknown): unknown {
  if (!isPlainRecord(parsed)) return parsed;
  if (!Array.isArray(parsed.choices)) return parsed;
  return { ...parsed, choices: parsed.choices.map(redactChoice) };
}

function redactChoice(choice: unknown): unknown {
  if (!isPlainRecord(choice)) return choice;
  const redacted = { ...choice };
  for (const field of ['message', 'delta'] as const) {
    const value = redacted[field];
    if (isPlainRecord(value)) {
      redacted[field] = redactGeneratedFields(value);
    }
  }
  return redacted;
}

const GENERATED_TEXT_FIELDS = ['content', 'reasoning', 'reasoning_content', 'refusal'] as const;

function redactGeneratedFields(message: Record<string, unknown>): Record<string, unknown> {
  const redacted = { ...message };
  for (const field of GENERATED_TEXT_FIELDS) {
    const value = redacted[field];
    if (typeof value === 'string' && value !== '') {
      redacted[field] = `[생성 텍스트 ${formatCount(value.length)}자 생략]`;
    }
  }
  return redacted;
}

// 수백 개 chunk로 흩어진 스트림은 원문 라인 그대로는 읽기 어렵다 — 진단 가치가
// 있는 chunk(role·finish_reason·usage 등)를 하나의 JSON으로 병합한 조합 뷰를
// 만들고, 조합 뷰라는 사실은 헤더 라인에 명시한다. JSON으로 읽지 못한 라인은
// 병합하지 않고 원문을 남겨 비정상 스트림 진단 경로를 보존한다.
function redactSseBody(bodyText: string): string {
  const mergeableEvents: Record<string, unknown>[] = [];
  const unmergeableLines: string[] = [];
  let totalChunkCount = 0;
  let droppedDeltaCount = 0;
  let droppedCharCount = 0;
  let sawDone = false;

  for (const line of bodyText.split('\n')) {
    if (!line.startsWith('data:')) {
      if (line.trim() !== '') unmergeableLines.push(line);
      continue;
    }
    totalChunkCount += 1;
    const payload = line.slice('data:'.length).trim();
    if (payload === '[DONE]') {
      sawDone = true;
      continue;
    }
    let event: unknown;
    try {
      event = JSON.parse(payload);
    } catch {
      unmergeableLines.push(line);
      continue;
    }
    const deltaTextLength = pureTextDeltaLength(event);
    if (deltaTextLength !== null) {
      droppedDeltaCount += 1;
      droppedCharCount += deltaTextLength;
      continue;
    }
    const redacted = maskSensitiveDeep(redactCompletionContent(event));
    if (isPlainRecord(redacted)) {
      mergeableEvents.push(redacted);
    } else {
      unmergeableLines.push(line);
    }
  }

  const headerParts = [`SSE ${formatCount(totalChunkCount)}개 chunk 조합`];
  if (droppedDeltaCount > 0) {
    headerParts.push(
      `생성 델타 ${formatCount(droppedDeltaCount)}개 · ${formatCount(droppedCharCount)}자 생략`,
    );
  }
  if (sawDone) headerParts.push('[DONE] 수신');

  const parts = [`[${headerParts.join(' · ')}]`];
  if (mergeableEvents.length > 0) {
    parts.push(JSON.stringify(mergeChunks(mergeableEvents), null, 2));
  }
  if (unmergeableLines.length > 0) {
    parts.push('조합 불가 라인:', ...unmergeableLines);
  }
  return parts.join('\n');
}

function pureTextDeltaLength(event: unknown): number | null {
  if (!isPlainRecord(event)) return null;
  if (event.usage !== undefined && event.usage !== null) return null;
  const choices = event.choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const choice = choices[0];
  if (!isPlainRecord(choice)) return null;
  if (choice.finish_reason !== undefined && choice.finish_reason !== null) return null;
  const delta = choice.delta;
  if (!isPlainRecord(delta)) return null;
  if (delta.tool_calls !== undefined) return null;
  const textLength = GENERATED_TEXT_FIELDS.reduce((length, field) => {
    const value = delta[field];
    return typeof value === 'string' ? length + value.length : length;
  }, 0);
  return textLength > 0 ? textLength : null;
}

function mergeChunks(events: readonly Record<string, unknown>[]): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const event of events) {
    mergeInto(merged, event);
  }
  return merged;
}

// 도착 순서대로 뒤 chunk가 이긴다. choices 같은 배열은 자리(index)별로 합쳐
// 첫 chunk의 role 선언과 마지막 chunk의 finish_reason이 한 객체에 모인다.
function mergeInto(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(source)) {
    const existing = target[key];
    if (Array.isArray(existing) && Array.isArray(value)) {
      value.forEach((item, index) => {
        const existingItem = existing[index];
        if (isPlainRecord(existingItem) && isPlainRecord(item)) {
          mergeInto(existingItem, item);
        } else if (index >= existing.length) {
          existing.push(item);
        } else if (item !== null && item !== undefined) {
          existing[index] = item;
        }
      });
    } else if (isPlainRecord(existing) && isPlainRecord(value)) {
      mergeInto(existing, value);
    } else if (value !== null && value !== undefined) {
      target[key] = value;
    } else if (!(key in target)) {
      // null 필드도 구조 확인용으로 최초 1회는 남긴다.
      target[key] = value;
    }
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function truncateBody(body: string): string {
  if (body.length <= MAX_BODY_CHARS) return body;
  return `${body.slice(0, MAX_BODY_CHARS)}\n…[${formatCount(body.length - MAX_BODY_CHARS)}자 잘림]`;
}

function formatCount(count: number): string {
  return count.toLocaleString('en-US');
}
