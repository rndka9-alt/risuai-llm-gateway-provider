import { describe, expect, it } from 'vitest';
import { toLlmMessages } from '../convert';

describe('toLlmMessages', () => {
  it('system/user/assistant role을 그대로 매핑한다', () => {
    const messages = toLlmMessages([
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
    ]);

    expect(messages).toEqual([
      { role: 'system', content: [{ type: 'text', text: 'system prompt' }] },
      { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
    ]);
  });

  it('function role은 user 로 전달한다', () => {
    const messages = toLlmMessages([{ role: 'function', content: 'legacy' }]);

    expect(messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'legacy' }] }]);
  });

  it('빈 content도 메시지를 유실하지 않는다', () => {
    const messages = toLlmMessages([{ role: 'user', content: '' }]);

    expect(messages).toEqual([{ role: 'user', content: [{ type: 'text', text: '' }] }]);
  });
});
