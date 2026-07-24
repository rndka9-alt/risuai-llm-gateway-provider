import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';

export interface FooterMessage {
  content: ComponentChildren;
  id: number;
  priority: number;
}

type FooterMessagesListener = () => void;

const footerMessagesListeners = new Set<FooterMessagesListener>();
let footerMessages: readonly FooterMessage[] = [];
let nextFooterMessageId = 1;

function getFooterMessages(): readonly FooterMessage[] {
  return footerMessages;
}

function subscribeFooterMessages(listener: FooterMessagesListener): () => void {
  footerMessagesListeners.add(listener);
  return () => footerMessagesListeners.delete(listener);
}

function publishFooterMessages(nextMessages: readonly FooterMessage[]): void {
  footerMessages = nextMessages;
  for (const listener of footerMessagesListeners) listener();
}

function upsertFooterMessage(message: FooterMessage): void {
  publishFooterMessages([
    ...footerMessages.filter((existing) => existing.id !== message.id),
    message,
  ]);
}

function removeFooterMessage(messageId: number): void {
  if (!footerMessages.some((existing) => existing.id === messageId)) return;
  publishFooterMessages(footerMessages.filter((existing) => existing.id !== messageId));
}

/**
 * 푸터에 표시할 메시지를 선언적으로 등록한다. content가 null이 되거나 컴포넌트가
 * 언마운트되면 제거된다. content가 렌더마다 새로 만들어지는 JSX면 재발행이
 * 반복되므로 문자열이나 참조가 안정된 노드를 넘겨야 한다.
 */
export function useFooterMessage(content: ComponentChildren | null, priority = 0): void {
  const [messageId] = useState(() => nextFooterMessageId++);
  useEffect(() => {
    if (content === null) {
      removeFooterMessage(messageId);
      return;
    }
    upsertFooterMessage({ content, id: messageId, priority });
    return () => removeFooterMessage(messageId);
  }, [content, messageId, priority]);
}

/** 우선순위가 가장 높은 메시지 하나를 고른다. 동순위면 나중에 발행된 쪽이 이긴다. */
export function useTopFooterMessage(): FooterMessage | null {
  const [messages, setMessages] = useState(getFooterMessages);
  useEffect(() => subscribeFooterMessages(() => setMessages(getFooterMessages())), []);

  let topMessage: FooterMessage | null = null;
  for (const message of messages) {
    if (topMessage === null || message.priority >= topMessage.priority) {
      topMessage = message;
    }
  }
  return topMessage;
}
