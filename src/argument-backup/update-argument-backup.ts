import type { BackedUpArgumentName } from './constants';
import { loadArgumentBackup } from './load-argument-backup';
import {
  getArgumentBackupSnapshot,
  setArgumentBackupSnapshot,
} from './memory';
import { saveArgumentBackup } from './save-argument-backup';
import { isNonEmptyArgumentValue } from './utils/is-non-empty-argument-value';

let argumentBackupUpdateQueue: Promise<void> = Promise.resolve();

export function updateArgumentBackup(
  argumentName: BackedUpArgumentName,
  value: string,
): Promise<void> {
  const update = argumentBackupUpdateQueue.then(async () => {
    const snapshot = getArgumentBackupSnapshot();
    const backup = snapshot === null ? await loadArgumentBackup() : snapshot;
    const updatedBackup = { ...backup };
    if (isNonEmptyArgumentValue(value)) updatedBackup[argumentName] = value;
    else delete updatedBackup[argumentName];

    // 직렬 queue의 다음 갱신은 debounce된 pluginStorage를 재읽지 않고 이 값을 이어받는다.
    setArgumentBackupSnapshot(updatedBackup);
    await saveArgumentBackup(updatedBackup);
  });
  argumentBackupUpdateQueue = update.then(
    () => undefined,
    (error: unknown) => {
      console.error('[llm-gateway-provider] argument backup update failed', error);
    },
  );
  return update;
}
