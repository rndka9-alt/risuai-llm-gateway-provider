import { mergeArgumentBackup } from './restore/merge-argument-backup';
import { readNonEmptyArguments } from './restore/read-non-empty-arguments';
import { restoreMissingArguments } from './restore/restore-missing-arguments';
import { loadArgumentBackup } from './storage/load-argument-backup';
import { saveArgumentBackup } from './storage/save-argument-backup';

export async function initializeArgumentBackupOnStartup(): Promise<void> {
  try {
    const backup = await loadArgumentBackup();
    const currentValues = await readNonEmptyArguments();
    const effectiveValues = await restoreMissingArguments(backup, currentValues);
    const mergedBackup = mergeArgumentBackup(backup, effectiveValues);
    await saveArgumentBackup(mergedBackup);
  } catch (error) {
    // 백업 저장소나 브릿지 실패 때문에 provider 등록과 채팅 요청이 막혀선 안 된다.
    console.error(
      '[llm-gateway-provider] argument backup startup synchronization failed; continuing',
      error,
    );
  }
}
