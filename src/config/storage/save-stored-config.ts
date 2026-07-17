import { CONFIG_STORAGE_KEY } from '../constants';
import { configSchema, type Config } from './schema';

export async function saveStoredConfig(config: Config): Promise<void> {
  const validatedConfig = configSchema.parse(config);
  await risuai.pluginStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(validatedConfig));
}
