import { CONFIG_STORAGE_KEY } from '../constants';
import { configSchema, type Config } from './schema';

export type StoredConfigResult =
  { status: 'missing' } | { status: 'corrupt' } | { status: 'valid'; config: Config };

export async function loadStoredConfig(): Promise<StoredConfigResult> {
  const raw = await risuai.pluginStorage.getItem(CONFIG_STORAGE_KEY);
  if (typeof raw !== 'string' || raw === '') return { status: 'missing' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.error('[llm-gateway-provider] corrupted config; resetting to defaults', error);
    return { status: 'corrupt' };
  }

  const result = configSchema.safeParse(parsed);
  if (!result.success) {
    console.error('[llm-gateway-provider] invalid config; resetting to defaults', result.error);
    return { status: 'corrupt' };
  }
  return { status: 'valid', config: result.data };
}
