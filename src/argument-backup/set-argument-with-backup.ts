import type { BackedUpArgumentName } from './constants';
import { updateArgumentBackup } from './storage/update-argument-backup';

export async function setArgumentWithBackup(
  argumentName: BackedUpArgumentName,
  value: string,
): Promise<void> {
  await risuai.setArgument(argumentName, value);
  await updateArgumentBackup(argumentName, value);
}
