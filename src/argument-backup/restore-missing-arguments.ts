import {
  BACKED_UP_ARGUMENT_NAMES,
  type BackedUpArgumentName,
} from './constants';
import type { ArgumentBackup } from './schema';
import { isNonEmptyArgumentValue } from './utils/is-non-empty-argument-value';

export async function restoreMissingArguments(
  backup: ArgumentBackup,
  currentValues: ReadonlyMap<BackedUpArgumentName, string>,
): Promise<Map<BackedUpArgumentName, string>> {
  const effectiveValues = new Map(currentValues);
  for (const argumentName of BACKED_UP_ARGUMENT_NAMES) {
    if (effectiveValues.has(argumentName)) continue;
    const backupValue = backup[argumentName];
    if (!isNonEmptyArgumentValue(backupValue)) continue;

    try {
      await risuai.setArgument(argumentName, backupValue);
      effectiveValues.set(argumentName, backupValue);
    } catch (error) {
      // 한 인자의 복원 실패가 다른 인자 복원이나 provider 등록을 막지 않게 격리한다.
      console.error(
        `[llm-gateway-provider] failed to restore argument ${argumentName}`,
        error,
      );
    }
  }
  return effectiveValues;
}
