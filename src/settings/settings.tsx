import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import {
  API_KEY_ARGUMENT,
  FLAGS_ARGUMENT,
  MODEL_ARGUMENT,
  PROMPT_CACHE_MODE_ARGUMENT,
  REASONING_EFFORT_ARGUMENT,
  SERVICE_TIER_ARGUMENT,
  STREAMING_MODE_ARGUMENT,
  VERBOSITY_ARGUMENT,
  loadConfig,
  saveConfig,
} from '../config';
import {
  isCacheBackoffActive,
  loadCacheAnchorState,
  resolvePromptCacheMode,
  type PromptCacheMode,
} from '../cache';
import {
  calculateNetSavedTokens,
  getCacheLedgerSnapshot,
  refreshCacheLedgerSnapshot,
  resetCacheLedger,
  subscribeCacheLedger,
  type CacheLedger,
} from '../ledger';
import {
  CONFIGURABLE_LLM_FLAG_NAMES,
  DEFAULT_MODEL,
  MODEL_OPTIONS,
  resolveConfigurableLlmFlagNames,
  resolveReasoningEffort,
  resolveServiceTier,
  resolveStreamingMode,
  resolveVerbosity,
  serializeConfigurableLlmFlagNames,
  type ConfigurableLlmFlagName,
  type ReasoningEffort,
  type ServiceTier,
  type StreamingMode,
  type Verbosity,
} from '../options';
import { applyTheme, resolveScheme } from '../theme';
import { SettingsPanel, type LedgerDisplay } from './components/SettingsPanel';

export type { LedgerDisplay } from './components/SettingsPanel';

const SETTINGS_STYLE_ID = 'llm-gateway-styles';
const SETTINGS_BODY_CLASS =
  'm-0 flex min-h-screen items-center justify-center bg-black/55 p-5 font-sans text-ui-content max-[420px]:p-2.5';

// streaming_mode는 요청 시 라이브로 읽혀 등록과 무관하므로, 재등록(새로고침)이
// 필요한 항목은 addProvider 시점에 굳는 flags뿐이다.
export interface ProviderRegistrationSettings {
  flagNames: readonly ConfigurableLlmFlagName[];
}

export async function loadApiKey(): Promise<string> {
  return (await loadConfig())[API_KEY_ARGUMENT];
}

export async function saveApiKey(value: string): Promise<void> {
  await saveConfig({ [API_KEY_ARGUMENT]: value });
}

export async function loadPromptCacheMode(): Promise<PromptCacheMode> {
  const config = await loadConfig();
  return resolvePromptCacheMode(config[PROMPT_CACHE_MODE_ARGUMENT]);
}

export async function savePromptCacheMode(value: PromptCacheMode): Promise<void> {
  await saveConfig({ [PROMPT_CACHE_MODE_ARGUMENT]: value });
}

export async function loadModel(): Promise<string> {
  const value = (await loadConfig())[MODEL_ARGUMENT];
  const trimmed = value.trim();
  return trimmed === '' ? DEFAULT_MODEL : trimmed;
}

export async function saveModel(value: string): Promise<void> {
  await saveConfig({ [MODEL_ARGUMENT]: value });
}

export async function loadServiceTier(): Promise<ServiceTier | undefined> {
  const config = await loadConfig();
  return resolveServiceTier(config[SERVICE_TIER_ARGUMENT]);
}

export async function saveServiceTier(value: ServiceTier | undefined): Promise<void> {
  await saveConfig({
    // 끔은 ''로 저장한다 — 생략이 조직 기본 티어를 살리는 배포된 의미 (resolveServiceTier 참고).
    [SERVICE_TIER_ARGUMENT]: value === 'flex' ? 'flex' : '',
  });
}

export async function loadReasoningEffort(): Promise<ReasoningEffort | undefined> {
  const config = await loadConfig();
  return resolveReasoningEffort(config[REASONING_EFFORT_ARGUMENT]);
}

export async function saveReasoningEffort(value: ReasoningEffort | undefined): Promise<void> {
  await saveConfig({ [REASONING_EFFORT_ARGUMENT]: value ?? '' });
}

export async function loadVerbosity(): Promise<Verbosity | undefined> {
  const config = await loadConfig();
  return resolveVerbosity(config[VERBOSITY_ARGUMENT]);
}

export async function saveVerbosity(value: Verbosity | undefined): Promise<void> {
  await saveConfig({ [VERBOSITY_ARGUMENT]: value ?? '' });
}

export async function loadStreamingMode(): Promise<StreamingMode> {
  const config = await loadConfig();
  return resolveStreamingMode(config[STREAMING_MODE_ARGUMENT]);
}

export async function saveStreamingMode(value: StreamingMode): Promise<void> {
  await saveConfig({ [STREAMING_MODE_ARGUMENT]: value });
}

export async function loadConfigurableLlmFlagNames(): Promise<readonly ConfigurableLlmFlagName[]> {
  const config = await loadConfig();
  return resolveConfigurableLlmFlagNames(config[FLAGS_ARGUMENT]);
}

export async function saveConfigurableLlmFlagNames(
  flagNames: readonly ConfigurableLlmFlagName[],
): Promise<void> {
  await saveConfig({
    [FLAGS_ARGUMENT]: serializeConfigurableLlmFlagNames(flagNames),
  });
}

export interface SettingsValues {
  apiKey: string;
  flagNames: readonly ConfigurableLlmFlagName[];
  model: string;
  promptCacheMode: PromptCacheMode;
  reasoningEffort: ReasoningEffort | undefined;
  serviceTier: ServiceTier | undefined;
  streamingMode: StreamingMode;
  verbosity: Verbosity | undefined;
}

export async function saveSettings(values: SettingsValues): Promise<void> {
  await saveConfig({
    [API_KEY_ARGUMENT]: values.apiKey,
    [MODEL_ARGUMENT]: values.model,
    [PROMPT_CACHE_MODE_ARGUMENT]: values.promptCacheMode,
    [SERVICE_TIER_ARGUMENT]: values.serviceTier === 'flex' ? 'flex' : '',
    [REASONING_EFFORT_ARGUMENT]: values.reasoningEffort ?? '',
    [VERBOSITY_ARGUMENT]: values.verbosity ?? '',
    [STREAMING_MODE_ARGUMENT]: values.streamingMode,
    [FLAGS_ARGUMENT]: serializeConfigurableLlmFlagNames(values.flagNames),
  });
}

export function createProviderRegistrationSignature(
  settings: ProviderRegistrationSettings,
): string {
  const sortedFlagNames = [...settings.flagNames].sort();
  return serializeConfigurableLlmFlagNames(sortedFlagNames);
}

export function formatTokenCount(value: number): string {
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (absolute >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return `${value}`;
}

// 손익을 대표값 하나로 보여준다 — 실측 절감 USD가 있으면 그것을, 없으면
// 입력 정가 토큰 등가(0.9R − 0.25W)를 쓴다. 원시 읽기/쓰기는 팝오버 상세로.
export function buildLedgerDisplay(ledger: CacheLedger): LedgerDisplay {
  const hasRecords =
    ledger.readTokens !== 0 ||
    ledger.writeTokens !== 0 ||
    ledger.costUsd !== 0 ||
    ledger.savedUsd !== 0;
  if (!hasRecords) {
    return { amountText: '아직 기록 없음', tone: 'neutral' };
  }

  const useUsd = ledger.savedUsd !== 0;
  const amountValue = useUsd ? ledger.savedUsd : calculateNetSavedTokens(ledger);
  const sign = amountValue >= 0 ? '+' : '-';
  const absolute = Math.abs(amountValue);
  const amountText = useUsd
    ? `${sign}$${absolute.toFixed(4)}`
    : `${sign}${formatTokenCount(absolute)} tokens`;

  return {
    amountText,
    tone: amountValue >= 0 ? 'gain' : 'loss',
  };
}

// 인자 편집 화면에서 직접 입력한 커스텀 모델 ID도 select에서 유실되지 않게 옵션으로 노출한다.
export function buildModelOptionList(currentModel: string): readonly string[] {
  return MODEL_OPTIONS.includes(currentModel) ? MODEL_OPTIONS : [currentModel, ...MODEL_OPTIONS];
}

interface SettingsAppProps extends SettingsValues {
  cacheBackoffActive: boolean;
  registrationSignature: string;
}

function useCacheLedgerSnapshot(): CacheLedger {
  const [snapshot, setSnapshot] = useState<CacheLedger>(getCacheLedgerSnapshot);
  // 요청 완료와 원장 초기화는 컴포넌트 밖에서 일어나므로 ledger store의 publish를
  // 구독해 화면용 snapshot만 갱신한다. 원장의 원천은 외부 store에 유지한다.
  useEffect(() => subscribeCacheLedger(() => setSnapshot(getCacheLedgerSnapshot())), []);
  return snapshot;
}

export function SettingsApp(initialValues: SettingsAppProps) {
  const [apiKey, setApiKey] = useState(initialValues.apiKey);
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
  const [model, setModel] = useState(initialValues.model);
  const [promptCacheMode, setPromptCacheMode] = useState(initialValues.promptCacheMode);
  const [serviceTier, setServiceTier] = useState(initialValues.serviceTier);
  const [reasoningEffort, setReasoningEffort] = useState(initialValues.reasoningEffort);
  const [verbosity, setVerbosity] = useState(initialValues.verbosity);
  const [streamingMode, setStreamingMode] = useState(initialValues.streamingMode);
  const [flagNames, setFlagNames] = useState(initialValues.flagNames);
  const [reloadNeeded, setReloadNeeded] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const cacheLedger = useCacheLedgerSnapshot();
  const [ledgerResetting, setLedgerResetting] = useState(false);
  const [ledgerResetFailed, setLedgerResetFailed] = useState(false);
  const ledgerDisplay = buildLedgerDisplay(cacheLedger);

  // 프로바이더가 매 요청 인자를 라이브로 읽으므로 저장 버튼 없이 native change
  // 시점에 바로 저장한다. 실패 표시는 다음 성공한 변경에서 해제한다.
  const persist = (save: () => Promise<void>): void => {
    save().then(
      () => setSaveFailed(false),
      (error: unknown) => {
        setSaveFailed(true);
        console.error('[llm-gateway-provider] Failed to save settings', error);
      },
    );
  };

  const updateFlag = (flagName: ConfigurableLlmFlagName, checked: boolean): void => {
    const selectedFlagNames = new Set(flagNames);
    if (checked) selectedFlagNames.add(flagName);
    else selectedFlagNames.delete(flagName);
    const nextFlagNames = CONFIGURABLE_LLM_FLAG_NAMES.filter((candidate) =>
      selectedFlagNames.has(candidate),
    );
    setFlagNames(nextFlagNames);
    setReloadNeeded(
      createProviderRegistrationSignature({ flagNames: nextFlagNames }) !==
        initialValues.registrationSignature,
    );
    persist(() => saveConfigurableLlmFlagNames(nextFlagNames));
  };

  const resetLedger = async (): Promise<void> => {
    setLedgerResetting(true);
    setLedgerResetFailed(false);
    try {
      await resetCacheLedger();
    } catch (error) {
      setLedgerResetFailed(true);
      console.error('[llm-gateway-provider] Failed to reset cache ledger', error);
    } finally {
      setLedgerResetting(false);
    }
  };

  return (
    <SettingsPanel
      apiKey={apiKey}
      apiKeyVisible={apiKeyVisible}
      cacheBackoffActive={initialValues.cacheBackoffActive}
      flagNames={flagNames}
      ledgerDisplay={ledgerDisplay}
      ledgerReadText={formatTokenCount(cacheLedger.readTokens)}
      ledgerResetFailed={ledgerResetFailed}
      ledgerResetting={ledgerResetting}
      ledgerWriteText={formatTokenCount(cacheLedger.writeTokens)}
      model={model}
      modelOptions={buildModelOptionList(model)}
      onApiKeyChange={(nextApiKey) => {
        setApiKey(nextApiKey);
        persist(() => saveApiKey(nextApiKey));
      }}
      onApiKeyVisibilityToggle={() => setApiKeyVisible((visible) => !visible)}
      onClose={() => void risuai.hideContainer()}
      onFlagChange={updateFlag}
      onLedgerReset={() => void resetLedger()}
      onModelChange={(nextModel) => {
        setModel(nextModel);
        persist(() => saveModel(nextModel));
      }}
      onPromptCacheModeChange={(nextMode) => {
        setPromptCacheMode(nextMode);
        persist(() => savePromptCacheMode(nextMode));
      }}
      onReasoningEffortChange={(nextEffort) => {
        setReasoningEffort(nextEffort);
        persist(() => saveReasoningEffort(nextEffort));
      }}
      onServiceTierChange={(nextTier) => {
        setServiceTier(nextTier);
        persist(() => saveServiceTier(nextTier));
      }}
      onStreamingModeChange={(nextMode) => {
        setStreamingMode(nextMode);
        persist(() => saveStreamingMode(nextMode));
      }}
      onVerbosityChange={(nextVerbosity) => {
        setVerbosity(nextVerbosity);
        persist(() => saveVerbosity(nextVerbosity));
      }}
      promptCacheMode={promptCacheMode}
      reasoningEffort={reasoningEffort}
      reloadNeeded={reloadNeeded}
      saveFailed={saveFailed}
      serviceTier={serviceTier}
      streamingMode={streamingMode}
      verbosity={verbosity}
    />
  );
}

function injectSettingsStyles(): void {
  if (document.getElementById(SETTINGS_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = SETTINGS_STYLE_ID;
  style.textContent = __SETTINGS_STYLES__;
  document.head.appendChild(style);
}

function renderSettings(initialValues: SettingsAppProps): void {
  injectSettingsStyles();
  document.documentElement.className = 'bg-transparent';
  document.body.className = SETTINGS_BODY_CLASS;
  render(<SettingsApp {...initialValues} />, document.body);
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

  renderSettings({
    apiKey,
    cacheBackoffActive: isCacheBackoffActive(cacheAnchorState),
    flagNames,
    model,
    promptCacheMode,
    reasoningEffort,
    registrationSignature: createProviderRegistrationSignature(registrationSettings),
    serviceTier,
    streamingMode,
    verbosity,
  });
  applyTheme(await resolveScheme());
}
