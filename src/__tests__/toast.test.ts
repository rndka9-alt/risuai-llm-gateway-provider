import { afterEach, describe, expect, it, vi } from 'vitest';
import { showCacheBackoffToast } from '../toast';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('showCacheBackoffToast', () => {
  it.each([
    ['activated', 'LLM Gateway: 캐시 히트 연속 3회 실패 — 캐시 마킹을 일시 중단했어요'],
    ['released', 'LLM Gateway: 프롬프트 앞부분이 안정되어 캐시 마킹을 다시 시작했어요'],
  ] satisfies ReadonlyArray<readonly ['activated' | 'released', string]>)(
    '%s 전환 토스트를 메인 DOM에 넣고 수 초 뒤 제거한다',
    async (transition, message) => {
      vi.useFakeTimers();
      const remove = vi.fn().mockResolvedValue(undefined);
      const toast = {
        remove,
        setStyleAttribute: vi.fn().mockResolvedValue(undefined),
        setTextContent: vi.fn().mockResolvedValue(undefined),
      };
      const body = { appendChild: vi.fn().mockResolvedValue(undefined) };
      const rootDocument = {
        createElement: vi.fn().mockReturnValue(toast),
        querySelector: vi.fn().mockResolvedValue(body),
      };
      vi.stubGlobal('risuai', {
        getRootDocument: vi.fn().mockResolvedValue(rootDocument),
      });

      await showCacheBackoffToast(transition);

      expect(toast.setTextContent).toHaveBeenCalledWith(message);
      expect(body.appendChild).toHaveBeenCalledWith(toast);
      expect(remove).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(4_500);
      expect(remove).toHaveBeenCalledOnce();
    },
  );

  it('메인 DOM 권한이 거부되면 경고만 남기고 완료한다', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const permissionError = new Error('permission denied');
    vi.stubGlobal('risuai', {
      getRootDocument: vi.fn().mockRejectedValue(permissionError),
    });

    await expect(showCacheBackoffToast('activated')).resolves.toBeUndefined();
    expect(warning).toHaveBeenCalledWith(
      '[llm-gateway-provider] cache backoff toast unavailable',
      permissionError,
    );
  });
});
