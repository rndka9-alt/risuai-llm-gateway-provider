import type { BackedUpArgumentName } from './constants';
import type { ArgumentBackup } from './schema';

export function mergeArgumentBackup(
  backup: ArgumentBackup,
  currentValues: ReadonlyMap<BackedUpArgumentName, string>,
): ArgumentBackup {
  const mergedBackup = { ...backup };
  currentValues.forEach((value, argumentName) => {
    mergedBackup[argumentName] = value;
  });
  return mergedBackup;
}
