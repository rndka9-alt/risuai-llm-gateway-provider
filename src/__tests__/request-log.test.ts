import { describe, expect, it, vi } from 'vitest';

// 링 버퍼가 모듈 상태라 테스트마다 새 모듈 인스턴스로 격리한다.
async function loadRequestLogModule() {
  vi.resetModules();
  return await import('../request-log');
}

const REQUEST_BODY = JSON.stringify({
  model: 'gpt-5.6',
  messages: [
    { role: 'system', content: '시스템 프롬프트 내용입니다' },
    {
      role: 'user',
      content: [
        { type: 'text', text: '유저가 쓴 텍스트' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA', detail: 'auto' } },
      ],
    },
  ],
  max_tokens: 512,
  prompt_cache_key: 'LGP:prompt-cache:v2:0123456789abcdef',
});

describe('request log', () => {
  it('wire 요청의 헤더를 마스킹하고 메시지 내용을 자리표시자로 치환한다', async () => {
    const { beginRequestLog, getRequestLogSnapshot } = await loadRequestLogModule();
    const recorder = beginRequestLog({ model: 'gpt-5.6', streamingMode: 'decoupled' });

    recorder.wireObserver.onRequest({
      url: 'https://api.llmgateway.io/v1/chat/completions',
      method: 'POST',
      headers: { Authorization: 'Bearer llmgtwy_secret_key_1234', 'Content-Type': 'application/json' },
      body: REQUEST_BODY,
    });

    const [entry] = getRequestLogSnapshot();
    expect(entry.request?.headers).toEqual({
      Authorization: 'Bearer llmg***',
      'Content-Type': 'application/json',
    });
    expect(entry.request?.body).not.toContain('시스템 프롬프트 내용입니다');
    expect(entry.request?.body).not.toContain('유저가 쓴 텍스트');
    expect(entry.request?.body).not.toContain('base64,AAAA');
    expect(entry.request?.body).toMatch(/\[본문 \d+자 생략\]/);
    expect(entry.request?.body).toMatch(/\[이미지 데이터 \d+자 생략\]/);
    expect(entry.request?.body).toContain('"max_tokens": 512');
    expect(entry.request?.body).toContain('LGP:prompt-cache:v2:0123456789abcdef');
  });

  it('JSON 응답의 생성 텍스트만 걷어내고 메타데이터는 보존한다', async () => {
    const { beginRequestLog, getRequestLogSnapshot } = await loadRequestLogModule();
    const recorder = beginRequestLog({ model: 'gpt-5.6', streamingMode: 'off' });

    recorder.wireObserver.onResponse({
      status: 200,
      headers: { 'content-type': 'application/json' },
      bodyText: JSON.stringify({
        id: 'chatcmpl-1',
        choices: [
          { message: { role: 'assistant', content: '비밀스러운 생성 응답' }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 4 },
      }),
    });

    const [entry] = getRequestLogSnapshot();
    expect(entry.response?.status).toBe(200);
    expect(entry.response?.body).not.toContain('비밀스러운 생성 응답');
    expect(entry.response?.body).toMatch(/\[생성 텍스트 \d+자 생략\]/);
    expect(entry.response?.body).toContain('"id": "chatcmpl-1"');
    expect(entry.response?.body).toContain('"finish_reason": "stop"');
    expect(entry.response?.body).toContain('"prompt_tokens": 10');
  });

  it('실패 응답 body는 생성 텍스트가 없어 온전히 보존된다', async () => {
    const { beginRequestLog, getRequestLogSnapshot } = await loadRequestLogModule();
    const recorder = beginRequestLog({ model: 'gpt-5.6', streamingMode: 'off' });

    recorder.wireObserver.onResponse({
      status: 400,
      headers: { 'content-type': 'application/json' },
      bodyText: JSON.stringify({
        success: false,
        error: { name: 'ZodError', issues: [{ path: ['model'], message: 'Required' }] },
      }),
    });

    const [entry] = getRequestLogSnapshot();
    expect(entry.response?.body).toContain('"name": "ZodError"');
    expect(entry.response?.body).toContain('"message": "Required"');
  });

  it('SSE 응답의 생성 델타를 요약으로 접고 진단 chunk는 남긴다', async () => {
    const { beginRequestLog, getRequestLogSnapshot } = await loadRequestLogModule();
    const recorder = beginRequestLog({ model: 'gpt-5.6', streamingMode: 'decoupled' });

    recorder.wireObserver.onResponse({
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
      bodyText: [
        'data: {"choices":[{"delta":{"role":"assistant","content":""}}]}',
        '',
        'data: {"choices":[{"delta":{"content":"안녕"}}]}',
        '',
        'data: {"choices":[{"delta":{"content":"하세요"}}]}',
        '',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
        '',
        'data: {"usage":{"prompt_tokens":12,"completion_tokens":2}}',
        '',
        'data: [DONE]',
      ].join('\n'),
    });

    const [entry] = getRequestLogSnapshot();
    expect(entry.response?.body).not.toContain('안녕');
    expect(entry.response?.body).not.toContain('하세요');
    expect(entry.response?.body).toContain(
      '[SSE 6개 chunk 조합 · 생성 델타 2개 · 5자 생략 · [DONE] 수신]',
    );
    expect(entry.response?.body).toContain('"role": "assistant"');
    expect(entry.response?.body).toContain('"finish_reason": "stop"');
    expect(entry.response?.body).toContain('"prompt_tokens": 12');
    expect(entry.response?.body).not.toContain('조합 불가 라인');
  });

  it('JSON으로 읽지 못한 SSE 라인은 병합하지 않고 원문을 남긴다', async () => {
    const { beginRequestLog, getRequestLogSnapshot } = await loadRequestLogModule();
    const recorder = beginRequestLog({ model: 'gpt-5.6', streamingMode: 'decoupled' });

    recorder.wireObserver.onResponse({
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
      bodyText: [
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
        'data: {broken json',
        ': keep-alive comment',
      ].join('\n'),
    });

    const [entry] = getRequestLogSnapshot();
    expect(entry.response?.body).toContain('"finish_reason": "stop"');
    expect(entry.response?.body).toContain('조합 불가 라인:');
    expect(entry.response?.body).toContain('data: {broken json');
    expect(entry.response?.body).toContain(': keep-alive comment');
  });

  it('최근 5개만 남기고 오래된 항목을 밀어낸다', async () => {
    const { beginRequestLog, getRequestLogSnapshot } = await loadRequestLogModule();

    for (let index = 1; index <= 6; index += 1) {
      beginRequestLog({ model: `model-${index}`, streamingMode: 'off' });
    }

    const snapshot = getRequestLogSnapshot();
    expect(snapshot).toHaveLength(5);
    expect(snapshot.map((entry) => entry.model)).toEqual([
      'model-6',
      'model-5',
      'model-4',
      'model-3',
      'model-2',
    ]);
  });

  it('성공 결과와 소요 시간을 기록하고 표시 텍스트에 담는다', async () => {
    const { beginRequestLog, formatRequestLogEntry, getRequestLogSnapshot } =
      await loadRequestLogModule();
    const recorder = beginRequestLog({ model: 'gpt-5.6', streamingMode: 'decoupled' });

    recorder.recordSuccess({ finishReason: 'stop', usage: { inputTokens: 10, outputTokens: 2 } });

    const [entry] = getRequestLogSnapshot();
    expect(entry.outcome).toEqual({
      kind: 'success',
      finishReason: 'stop',
      usage: { inputTokens: 10, outputTokens: 2 },
    });
    expect(entry.durationMs).toBeGreaterThanOrEqual(0);

    const formatted = formatRequestLogEntry(entry);
    expect(formatted).toContain('결과: 성공 (finishReason=stop)');
    // 정규화 usage는 wire 원문과 표기가 달라 혼란을 줘 표시하지 않는다 (데이터로만 유지).
    expect(formatted).not.toContain('inputTokens');
  });

  it('wire 기록 없는 실패는 전송 전 실패로 표시한다', async () => {
    const { beginRequestLog, formatRequestLogEntry, getRequestLogSnapshot } =
      await loadRequestLogModule();
    const recorder = beginRequestLog({ model: 'gpt-5.6', streamingMode: 'off' });

    recorder.recordFailure('플러그인 저장소에서 프롬프트 캐시 키와 상태를 읽거나 쓰지 못했어요.');

    const formatted = formatRequestLogEntry(getRequestLogSnapshot()[0]);
    expect(formatted).toContain('요청: wire 전송 기록 없음 (전송 전 실패)');
    expect(formatted).toContain('결과: 실패');
    expect(formatted).toContain('프롬프트 캐시 키와 상태를 읽거나 쓰지 못했어요');
  });

  it('기록이 갱신될 때마다 구독자에게 알린다', async () => {
    const { beginRequestLog, subscribeRequestLog } = await loadRequestLogModule();
    const listener = vi.fn();
    const unsubscribe = subscribeRequestLog(listener);

    const recorder = beginRequestLog({ model: 'gpt-5.6', streamingMode: 'off' });
    recorder.recordFailure('실패');

    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    beginRequestLog({ model: 'gpt-5.6', streamingMode: 'off' });
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
