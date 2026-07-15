import type { LlmMessage, LlmMessageRole } from 'llm-io';

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
    content: [{ type: 'text', text: message.content }],
  }));
}
