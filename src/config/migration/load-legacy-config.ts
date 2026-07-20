import { z } from 'zod';
import {
  CONFIG_FIELD_NAMES,
  LEGACY_ARGUMENT_BACKUP_STORAGE_KEY,
  type ConfigFieldName,
} from '../constants';
import { configSchema, type Config, type ConfigUpdate } from '../storage/schema';

const legacyArgumentBackupSchema = z.record(z.string(), z.string());

function selectNonEmptyConfigValues(
  values: Readonly<Record<string, string | undefined>>,
): ConfigUpdate {
  const selectedValues: ConfigUpdate = {};
  for (const fieldName of CONFIG_FIELD_NAMES) {
    const value = values[fieldName];
    if (typeof value === 'string' && value !== '') {
      selectedValues[fieldName] = value;
    }
  }
  return selectedValues;
}

async function loadLegacyArgumentBackup(): Promise<ConfigUpdate | null> {
  const raw = await risuai.pluginStorage.getItem(LEGACY_ARGUMENT_BACKUP_STORAGE_KEY);
  if (typeof raw !== 'string' || raw === '') return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.error(
      '[llm-gateway-provider] corrupted legacy argument backup; falling back to realArg',
      error,
    );
    return null;
  }

  const result = legacyArgumentBackupSchema.safeParse(parsed);
  if (!result.success) {
    console.error(
      '[llm-gateway-provider] invalid legacy argument backup; falling back to realArg',
      result.error,
    );
    return null;
  }
  return selectNonEmptyConfigValues(result.data);
}

async function loadLegacyRealArguments(): Promise<ConfigUpdate> {
  const entries = await Promise.all(
    CONFIG_FIELD_NAMES.map(async (fieldName: ConfigFieldName) => ({
      fieldName,
      value: await risuai.getArgument(fieldName),
    })),
  );
  const values: Record<string, string | undefined> = {};
  entries.forEach(({ fieldName, value }) => {
    values[fieldName] = typeof value === 'string' ? value : undefined;
  });
  return selectNonEmptyConfigValues(values);
}

export async function loadLegacyConfig(): Promise<Config> {
  const legacyArgumentBackup = await loadLegacyArgumentBackup();
  const legacyValues = legacyArgumentBackup ?? (await loadLegacyRealArguments());
  return configSchema.parse(legacyValues);
}
