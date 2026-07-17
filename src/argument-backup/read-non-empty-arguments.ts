import {
  BACKED_UP_ARGUMENT_NAMES,
  type BackedUpArgumentName,
} from './constants';
import { isNonEmptyArgumentValue } from './utils/is-non-empty-argument-value';

export async function readNonEmptyArguments(): Promise<
  Map<BackedUpArgumentName, string>
> {
  const values = new Map<BackedUpArgumentName, string>();
  const entries = await Promise.all(
    BACKED_UP_ARGUMENT_NAMES.map(async (argumentName) => ({
      argumentName,
      value: await risuai.getArgument(argumentName),
    })),
  );
  entries.forEach(({ argumentName, value }) => {
    if (isNonEmptyArgumentValue(value)) values.set(argumentName, value);
  });
  return values;
}
