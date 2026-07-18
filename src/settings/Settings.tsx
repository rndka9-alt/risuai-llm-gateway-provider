import { render } from 'preact';
import { isCacheBackoffActive, loadCacheAnchorState } from '../cache';
import { refreshCacheLedgerSnapshot } from '../ledger';
import { applyTheme, resolveScheme } from '../theme';
import { SettingsPanel } from './components/SettingsPanel/SettingsPanel';
import {
  createProviderRegistrationSignature,
  type ProviderRegistrationSettings,
} from './utils/registration';
import { initializeSettingsSignals } from './utils/signals';
import { initializeSettingsSnapshot } from './utils/settings-snapshot';
import {
  loadApiKey,
  loadConfigurableLlmFlagNames,
  loadModel,
  loadPromptCacheMode,
  loadReasoningEffort,
  loadServiceTier,
  loadStreamingMode,
  loadVerbosity,
} from './utils/storage';

const SETTINGS_STYLE_ID = 'llm-gateway-styles';
const SETTINGS_BODY_CLASS =
  'm-0 flex min-h-screen items-center justify-center bg-black/55 p-5 font-sans text-ui-content max-[420px]:p-2.5';

function injectSettingsStyles(): void {
  if (document.getElementById(SETTINGS_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = SETTINGS_STYLE_ID;
  style.textContent = __SETTINGS_STYLES__;
  document.head.appendChild(style);
}

function renderSettings(cacheBackoffActive: boolean): void {
  injectSettingsStyles();
  document.documentElement.className = 'bg-transparent';
  document.body.className = SETTINGS_BODY_CLASS;
  render(<SettingsPanel cacheBackoffActive={cacheBackoffActive} />, document.body);
}

export async function openSettings(
  registrationSettings: ProviderRegistrationSettings,
): Promise<void> {
  await risuai.showContainer('fullscreen');

  const [
    apiKey,
    model,
    promptCacheMode,
    serviceTier,
    reasoningEffort,
    verbosity,
    streamingMode,
    flagNames,
    cacheAnchorState,
  ] = await Promise.all([
    loadApiKey(),
    loadModel(),
    loadPromptCacheMode(),
    loadServiceTier(),
    loadReasoningEffort(),
    loadVerbosity(),
    loadStreamingMode(),
    loadConfigurableLlmFlagNames(),
    loadCacheAnchorState(),
    refreshCacheLedgerSnapshot(),
  ]);

  const registrationSignature = createProviderRegistrationSignature(registrationSettings);

  initializeSettingsSnapshot({
    apiKey,
    flagNames,
    model,
    promptCacheMode,
    reasoningEffort,
    registrationSignature,
    serviceTier,
    streamingMode,
    verbosity,
  });
  // iframe이 유지되는 재오픈에서도 저장된 flags가 등록 스냅샷과 다르면 아직 미적용
  // 상태이므로, 새로고침 안내를 false 리셋 대신 시그니처 비교로 복원한다.
  initializeSettingsSignals({
    reloadNeeded: createProviderRegistrationSignature({ flagNames }) !== registrationSignature,
  });
  renderSettings(isCacheBackoffActive(cacheAnchorState));
  applyTheme(await resolveScheme());
}
