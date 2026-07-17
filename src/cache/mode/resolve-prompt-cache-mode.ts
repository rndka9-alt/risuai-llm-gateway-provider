import type { PromptCacheMode } from '../types';

// 실측으로 캐시 이득(읽기 0.1×)과 무해성(잘못된 BP는 조용한 무시)이 확인되어
// 미지정 시 explicit을 기본값으로 켠다.
export function resolvePromptCacheMode(value: string | undefined): PromptCacheMode {
  return value?.trim() === 'disabled' ? 'disabled' : 'explicit';
}
