import type { LlmContentPart, LlmMessage, LlmMessageRole } from 'llm-io';

// RisuAI prompt_chat 의 'function' role은 레거시 함수 호출용으로, 대응되는
// llm-io role이 없다. 플러그인 프로바이더 경로에서는 사실상 등장하지 않지만
// 메시지를 유실하지 않도록 user 로 전달한다.
const ROLE_MAP: Record<OpenAIChat['role'], LlmMessageRole> = {
  system: 'system',
  user: 'user',
  assistant: 'assistant',
  function: 'user',
};

export function toLlmMessages(promptChat: readonly OpenAIChat[]): LlmMessage[] {
  return promptChat.map((message) => ({
    role: ROLE_MAP[message.role],
    content: toLlmContent(message),
  }));
}

function toLlmContent(message: OpenAIChat): LlmContentPart[] {
  const multimodals = message.multimodals;
  if (multimodals === undefined || multimodals.length === 0) {
    return [{ type: 'text', text: message.content }];
  }
  if (message.role !== 'user') {
    throw new Error('[llm-gateway-provider] image inputs require a user message');
  }

  const content: LlmContentPart[] = multimodals.map((multimodal) => {
    if (multimodal.type !== 'image') {
      throw new Error(
        `[llm-gateway-provider] unsupported multimodal input type: ${multimodal.type}`,
      );
    }
    return {
      type: 'image',
      source: { type: 'url', url: multimodal.base64 },
      ...(multimodal.height === undefined ? {} : { height: multimodal.height }),
      ...(multimodal.width === undefined ? {} : { width: multimodal.width }),
    };
  });

  // RisuAI의 OpenAI 경로와 같은 image-first 순서를 유지한다. 순서는 캐시
  // prefix identity의 일부이며, 빈 텍스트는 image-only BP를 가리지 않게 생략한다.
  if (message.content !== '') content.push({ type: 'text', text: message.content });
  return content;
}
