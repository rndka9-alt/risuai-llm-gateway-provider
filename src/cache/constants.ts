export const EXPLICIT_PROMPT_CACHE_KEY = 'risuai:llm-gateway-provider:v1';
export const DISABLED_PROMPT_CACHE_KEY = 'risuai:llm-gateway-provider:v1:disabled';

// pluginStorage는 전 플러그인 공용 네임스페이스라 접두사가 필수다.
// 이 키는 구버전 단일 상태와 신버전 bank index가 공유한다. 신버전 index는
// 구버전 state schema에 맞지 않아 롤백 시 안전하게 새 epoch로 강하한다.
export const CACHE_ANCHOR_STATE_STORAGE_KEY = 'llm-gateway-provider:cache-anchor-state';
export const CACHE_ANCHOR_BANK_SLOT_STORAGE_KEY_PREFIX = `${CACHE_ANCHOR_STATE_STORAGE_KEY}:`;
export const BANK_MAX_STATES = 16;

// OpenAI는 1024토큰 미만 프리픽스를 캐시하지 않고, explicit 문서상 non-cacheable
// 지점의 breakpoint는 400이 될 수도 있으므로 미달 추정 시 마킹을 생략한다.
export const MIN_CACHEABLE_PREFIX_TOKENS = 1024;
export const CACHE_BACKOFF_BANK_MISS_THRESHOLD = 3;
// frontier가 구조적 사망(성장·수축·시프트)을 이 횟수만큼 연속하면, 다음 새
// frontier 마킹을 보류해 어차피 죽을 심층 write 프리미엄을 차단한다.
export const FRONTIER_DEATH_MONITOR_THRESHOLD = 2;

// 위험 후보가 다음 요청에서도 겹치면 breakpoint로 admission한다. 실제 단가에선
// 한 번의 완전 hit으로 write premium을 상각하므로 첫 재사용 기회를 흘리지 않는다.
export const ANCHOR_ADMISSION_SURVIVAL_THRESHOLD = 1;

// v0.8 상태와 롤백 호환을 위해 admitted 후보는 기존 완료값 2로 저장한다.
export const ADMITTED_ANCHOR_SURVIVAL_COUNT = 2;

// 기존 마킹 prefix에서 한 번에 16k 토큰을 넘는 확장은 즉시 쓰지 않고 생존
// 검증 대상으로 돌린다. 실제 write는 gateway tokenizer가 정하지만, planner
// 추정치로 검증 없는 단일 오판의 write premium을 제한한다.
export const MAX_NEW_CACHE_WRITE_TOKENS = 16_384;
