import { CONFIG_STORAGE_KEY } from './config';

// pluginStorage는 전 플러그인 공용 네임스페이스라 접두사가 필수다.
export const PROVIDER_REGISTERED_STORAGE_KEY = 'llm-gateway-provider:provider-registered';

/**
 * 과거 로드에서 provider 등록(addProvider)까지 마친 적이 있는지.
 * false면 첫 설치 세션 — RisuAI 모델 목록 반영에 새로고침이 필요하다.
 *
 * 플래그 도입 전 사용자는 키가 없으므로, 첫 부팅에 생성되는 config의 존재를
 * 등록 이력으로 호환 읽기한다. config 초기화가 먼저 실행되면 첫 설치도
 * 기존 사용자로 판별되니 반드시 initializeConfigOnStartup보다 먼저 호출한다.
 */
export async function loadProviderRegistered(): Promise<boolean> {
  try {
    if ((await risuai.pluginStorage.getItem(PROVIDER_REGISTERED_STORAGE_KEY)) === 'true') {
      return true;
    }
    const storedConfig = await risuai.pluginStorage.getItem(CONFIG_STORAGE_KEY);
    return typeof storedConfig === 'string' && storedConfig !== '';
  } catch (error) {
    // 저장소 실패가 부팅을 막아선 안 된다. false로 읽혀도 설치 안내가 한 번 더 보일 뿐이다.
    console.error('[llm-gateway-provider] failed to load provider-registered state', error);
    return false;
  }
}

export async function markProviderRegistered(): Promise<void> {
  try {
    await risuai.pluginStorage.setItem(PROVIDER_REGISTERED_STORAGE_KEY, 'true');
  } catch (error) {
    console.error('[llm-gateway-provider] failed to mark provider registered', error);
  }
}
