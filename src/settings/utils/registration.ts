import { serializeConfigurableLlmFlagNames, type ConfigurableLlmFlagName } from '../../options';

// streaming_mode는 요청 시 라이브로 읽혀 등록과 무관하므로, 재등록(새로고침)이
// 필요한 항목은 addProvider 시점에 굳는 flags뿐이다.
export interface ProviderRegistrationSettings {
  flagNames: readonly ConfigurableLlmFlagName[];
}

export function createProviderRegistrationSignature(
  settings: ProviderRegistrationSettings,
): string {
  const sortedFlagNames = [...settings.flagNames].sort();
  return serializeConfigurableLlmFlagNames(sortedFlagNames);
}
