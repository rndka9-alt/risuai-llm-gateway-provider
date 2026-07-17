import type { BackedUpArgumentName } from '../constants';
import { loadArgumentBackup } from './load-argument-backup';
import { saveArgumentBackup } from './save-argument-backup';
import { isNonEmptyArgumentValue } from '../utils/is-non-empty-argument-value';

export async function updateArgumentBackup(
  argumentName: BackedUpArgumentName,
  value: string,
): Promise<void> {
  const backup = await loadArgumentBackup();
  const updatedBackup = { ...backup };
  if (isNonEmptyArgumentValue(value)) updatedBackup[argumentName] = value;
  else delete updatedBackup[argumentName];

  // 캐시 원장·앵커 상태와 같이 실사용 경로가 순차 실행되므로 비원자 RMW를 수용한다.
  await saveArgumentBackup(updatedBackup);
}
