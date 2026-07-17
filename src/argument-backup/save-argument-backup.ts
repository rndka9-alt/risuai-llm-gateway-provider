import { ARGUMENT_BACKUP_STORAGE_KEY } from './constants';
import type { ArgumentBackup } from './schema';

export async function saveArgumentBackup(backup: ArgumentBackup): Promise<void> {
  await risuai.pluginStorage.setItem(
    ARGUMENT_BACKUP_STORAGE_KEY,
    JSON.stringify(backup),
  );
}
