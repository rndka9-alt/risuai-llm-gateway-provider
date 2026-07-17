import { ARGUMENT_BACKUP_STORAGE_KEY } from '../constants';
import { argumentBackupSchema, type ArgumentBackup } from './schema';

export async function loadArgumentBackup(): Promise<ArgumentBackup> {
  const raw = await risuai.pluginStorage.getItem(ARGUMENT_BACKUP_STORAGE_KEY);
  if (typeof raw !== 'string' || raw === '') return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.error('[llm-gateway-provider] corrupted argument backup; starting from empty', error);
    return {};
  }
  const result = argumentBackupSchema.safeParse(parsed);
  return result.success ? result.data : {};
}
