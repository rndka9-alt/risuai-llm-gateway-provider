import { loadLegacyConfig } from './migration/load-legacy-config';
import { loadStoredConfig } from './storage/load-stored-config';
import { saveStoredConfig } from './storage/save-stored-config';
import { createDefaultConfig, type Config } from './storage/schema';

export async function initializeConfigOnStartup(): Promise<Config> {
  try {
    const storedConfig = await loadStoredConfig();
    if (storedConfig.status === 'valid') return storedConfig.config;

    const config =
      storedConfig.status === 'missing' ? await loadLegacyConfig() : createDefaultConfig();
    await saveStoredConfig(config);
    return config;
  } catch (error) {
    // 설정 저장소 실패 때문에 provider 등록과 채팅 요청이 막혀선 안 된다.
    console.error(
      '[llm-gateway-provider] config startup initialization failed; continuing with defaults',
      error,
    );
    return createDefaultConfig();
  }
}
