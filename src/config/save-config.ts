import { loadConfig } from './load-config';
import { saveStoredConfig } from './storage/save-stored-config';
import { configSchema, type ConfigUpdate } from './storage/schema';

export async function saveConfig(update: ConfigUpdate): Promise<void> {
  const currentConfig = await loadConfig();
  const nextConfig = configSchema.parse({ ...currentConfig, ...update });

  // 캐시 원장·앵커 상태와 같은 정책으로 pluginStorage의 비원자 RMW를 수용한다.
  await saveStoredConfig(nextConfig);
}
