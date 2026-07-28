import { maskSensitiveDeep } from './mask-sensitive-deep';

// '내 요청이 잘 실렸는가'에 답하도록 wire 구조 전체를 보존하되, 채팅 내용
// (messages[].content)만 자리표시자로 치환한다. 성공/실패에 따른 조건 규칙 없이
// "내용 필드 컷" 하나만 적용한다.
export function redactRequestBody(body: string | undefined): string {
  if (body === undefined || body === '') return '[본문 없음]';
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return `[JSON이 아닌 요청 본문 ${formatCount(body.length)}자]`;
  }
  return JSON.stringify(maskSensitiveDeep(redactMessages(parsed)), null, 2);
}

function redactMessages(parsed: unknown): unknown {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return parsed;
  const record = parsed as Record<string, unknown>;
  if (!Array.isArray(record.messages)) return parsed;
  return { ...record, messages: record.messages.map(redactMessageContent) };
}

function redactMessageContent(message: unknown): unknown {
  if (typeof message !== 'object' || message === null) return message;
  const record = message as Record<string, unknown>;
  if (!('content' in record)) return message;
  return { ...record, content: summarizeContent(record.content) };
}

function summarizeContent(content: unknown): unknown {
  if (typeof content === 'string') return placeholderForText(content);
  if (Array.isArray(content)) return content.map(summarizeContentPart);
  return '[내용 생략]';
}

function summarizeContentPart(part: unknown): unknown {
  if (typeof part !== 'object' || part === null) return '[내용 생략]';
  const record = part as Record<string, unknown>;
  if (record.type === 'text' && typeof record.text === 'string') {
    return { ...record, text: placeholderForText(record.text) };
  }
  if (record.type === 'image_url' && typeof record.image_url === 'object' && record.image_url !== null) {
    const imageUrl = record.image_url as Record<string, unknown>;
    const url = typeof imageUrl.url === 'string' ? imageUrl.url : '';
    return {
      ...record,
      image_url: { ...imageUrl, url: `[이미지 데이터 ${formatCount(url.length)}자 생략]` },
    };
  }
  const serializedLength = JSON.stringify(record)?.length ?? 0;
  const partType = typeof record.type === 'string' ? record.type : '알 수 없는';
  return `[${partType} 파트 ${formatCount(serializedLength)}자 생략]`;
}

function placeholderForText(text: string): string {
  return `[본문 ${formatCount(text.length)}자 생략]`;
}

function formatCount(count: number): string {
  return count.toLocaleString('en-US');
}
