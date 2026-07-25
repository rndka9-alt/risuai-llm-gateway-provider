// pluginStorage는 전 플러그인 공용 네임스페이스라 접두사가 필수다.
export const CACHE_LEDGER_STORAGE_KEY = 'llm-gateway-provider:cache-ledger';

// 캐시 쓰기 = 입력 정가의 1.25배(순수 추가비용 0.25배), 읽기 = 정가의 10%
// (절감 0.9배) 전제. 손익 표시 공식이 바뀔 수 있으므로 계산 결과가 아닌
// 읽기/쓰기 원시 토큰을 누적한다.
export const CACHE_WRITE_PREMIUM_RATE = 0.25;
export const CACHE_READ_SAVING_RATE = 0.9;
