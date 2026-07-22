import type { CacheBackoffTransition } from './cache';

const TOAST_DURATION_MILLISECONDS = 4_500;

const CACHE_BACKOFF_TOAST_MESSAGES: Record<CacheBackoffTransition, string> = {
  activated: 'LLM Gateway: 캐시 히트 연속 3회 실패 — 캐시 마킹을 일시 중단했어요',
  released: 'LLM Gateway: 프롬프트 앞부분이 안정되어 캐시 마킹을 다시 시작했어요',
};

export async function showCacheBackoffToast(transition: CacheBackoffTransition): Promise<void> {
  try {
    if (typeof risuai.getRootDocument !== 'function') {
      throw new Error('getRootDocument API is unavailable');
    }

    const rootDocument = await risuai.getRootDocument();
    const body = await rootDocument.querySelector('body');
    if (body === null) throw new Error('Main document body is unavailable');

    const toast = rootDocument.createElement('div');
    await toast.setTextContent(CACHE_BACKOFF_TOAST_MESSAGES[transition]);
    await toast.setStyleAttribute(
      'position:fixed;right:16px;bottom:16px;z-index:2147483647;' +
        'max-width:min(360px,calc(100vw - 32px));padding:10px 14px;border-radius:8px;' +
        'background:rgba(24,24,27,.96);color:#fff;box-shadow:0 8px 24px rgba(0,0,0,.3);' +
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;' +
        'font-size:14px;line-height:1.45;pointer-events:none;',
    );
    await body.appendChild(toast);

    setTimeout(() => {
      void toast.remove().catch((error: unknown) => {
        console.warn('[llm-gateway-provider] cache backoff toast cleanup failed', error);
      });
    }, TOAST_DURATION_MILLISECONDS);
  } catch (error) {
    // 플러그인 v3에 토스트 API가 없어 SafeDocument 권한을 써야 한다. 권한 거부나
    // 구버전 API 부재는 관측 UI만 포기하고 요청·캐시 상태 갱신에는 영향을 주지 않는다.
    console.warn('[llm-gateway-provider] cache backoff toast unavailable', error);
  }
}
