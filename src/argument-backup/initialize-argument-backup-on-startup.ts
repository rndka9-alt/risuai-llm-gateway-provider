import { restoreAndMergeArgumentBackup } from './restore-and-merge-argument-backup';

export async function initializeArgumentBackupOnStartup(): Promise<void> {
  try {
    await restoreAndMergeArgumentBackup();
  } catch (error) {
    // 백업 저장소나 브릿지 실패 때문에 provider 등록과 채팅 요청이 막혀선 안 된다.
    console.error(
      '[llm-gateway-provider] argument backup startup synchronization failed; continuing',
      error,
    );
  }
}
