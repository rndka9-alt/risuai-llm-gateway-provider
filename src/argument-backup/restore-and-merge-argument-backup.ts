import { loadArgumentBackup } from './load-argument-backup';
import { setArgumentBackupSnapshot } from './memory';
import { mergeArgumentBackup } from './merge-argument-backup';
import { readNonEmptyArguments } from './read-non-empty-arguments';
import { restoreMissingArguments } from './restore-missing-arguments';
import { saveArgumentBackup } from './save-argument-backup';

export async function restoreAndMergeArgumentBackup(): Promise<void> {
  const backup = await loadArgumentBackup();
  const currentValues = await readNonEmptyArguments();
  const effectiveValues = await restoreMissingArguments(backup, currentValues);
  const mergedBackup = mergeArgumentBackup(backup, effectiveValues);

  // pluginStorage 쓰기는 debounce되므로 직후 재읽지 않고 같은 스냅샷을 후속 저장에 쓴다.
  setArgumentBackupSnapshot(mergedBackup);
  await saveArgumentBackup(mergedBackup);
}
