import type { ArgumentBackup } from './schema';

let argumentBackupSnapshot: ArgumentBackup | null = null;

export function getArgumentBackupSnapshot(): ArgumentBackup | null {
  return argumentBackupSnapshot;
}

export function setArgumentBackupSnapshot(backup: ArgumentBackup): void {
  argumentBackupSnapshot = backup;
}
