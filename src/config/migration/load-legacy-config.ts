import { z } from 'zod';
import {
  CONFIG_FIELD_NAMES,
  LEGACY_ARGUMENT_BACKUP_STORAGE_KEY,
  SERVICE_TIER_ARGUMENT,
  type ConfigFieldName,
} from '../constants';
import { configSchema, type Config, type ConfigUpdate } from '../storage/schema';

const legacyArgumentBackupSchema = z.record(z.string(), z.string());

type LegacyArgumentBackupResult =
  { status: 'missing' } | { status: 'invalid' } | { status: 'valid'; values: ConfigUpdate };

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

async function loadLegacyArgumentBackup(): Promise<LegacyArgumentBackupResult> {
  const raw = await risuai.pluginStorage.getItem(LEGACY_ARGUMENT_BACKUP_STORAGE_KEY);
  if (typeof raw !== 'string' || raw === '') return { status: 'missing' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.error(
      '[llm-gateway-provider] corrupted legacy argument backup; falling back to realArg',
      error,
    );
    return { status: 'invalid' };
  }

  const result = legacyArgumentBackupSchema.safeParse(parsed);
  if (!result.success) {
    console.error(
      '[llm-gateway-provider] invalid legacy argument backup; falling back to realArg',
      result.error,
    );
    return { status: 'invalid' };
  }
  return { status: 'valid', values: selectNonEmptyConfigValues(result.data) };
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
  if (legacyArgumentBackup.status === 'valid') {
    return configSchema.parse(legacyArgumentBackup.values);
  }

  const legacyValues = await loadLegacyRealArguments();
  // 빈 backup도 구버전이 만들어 둔 설치 이력이다. 저장 이력과 realArg가 모두 없는
  // 진짜 첫 설치에만 새 기본값을 심어 기존의 Standard(구 Gateway 기본) 선택을 Flex로 뒤집지 않는다.
  const isFirstInstallation =
    legacyArgumentBackup.status === 'missing' && Object.keys(legacyValues).length === 0;
  if (isFirstInstallation) {
    return configSchema.parse({ [SERVICE_TIER_ARGUMENT]: 'flex' });
  }

  return configSchema.parse(legacyValues);
}
