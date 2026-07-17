import { loadStoredConfig } from './storage/load-stored-config';
import { createDefaultConfig, type Config } from './storage/schema';
import { saveStoredConfig } from './storage/save-stored-config';

export async function loadConfig(): Promise<Config> {
  const storedConfig = await loadStoredConfig();
  if (storedConfig.status === 'valid') return storedConfig.config;

  const defaultConfig = createDefaultConfig();
  if (storedConfig.status === 'corrupt') {
    await saveStoredConfig(defaultConfig);
  }
  return defaultConfig;
}
