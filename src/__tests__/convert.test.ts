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

  it('user 이미지를 RisuAI와 같은 image-first 순서로 변환한다', () => {
    const messages = toLlmMessages([
      {
        role: 'user',
        content: '이미지를 설명해줘',
        multimodals: [
          {
            type: 'image',
            base64: 'data:image/png;base64,abc',
            width: 1024,
            height: 768,
          },
        ],
      },
    ]);

    expect(messages).toEqual([
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'url', url: 'data:image/png;base64,abc' },
            width: 1024,
            height: 768,
          },
          { type: 'text', text: '이미지를 설명해줘' },
        ],
      },
    ]);
  });

  it('image-only 메시지는 빈 text part를 만들지 않는다', () => {
    const messages = toLlmMessages([
      {
        role: 'user',
        content: '',
        multimodals: [{ type: 'image', base64: 'data:image/png;base64,abc' }],
      },
    ]);

    expect(messages).toEqual([
      {
        role: 'user',
        content: [{ type: 'image', source: { type: 'url', url: 'data:image/png;base64,abc' } }],
      },
    ]);
  });

  it('user가 아닌 role의 이미지는 명시적으로 거절한다', () => {
    expect(() =>
      toLlmMessages([
        {
          role: 'assistant',
          content: 'image',
          multimodals: [{ type: 'image', base64: 'data:image/png;base64,abc' }],
        },
      ]),
    ).toThrow('image inputs require a user message');
  });

  it('지원하지 않는 multimodal 타입을 명시적으로 거절한다', () => {
    expect(() =>
      toLlmMessages([
        {
          role: 'user',
          content: 'audio',
          multimodals: [{ type: 'audio', base64: 'data:audio/wav;base64,abc' }],
        },
      ]),
    ).toThrow('unsupported multimodal input type: audio');
  });
});
