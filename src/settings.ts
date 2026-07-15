import { STYLES } from './constants';
import {
  PROMPT_CACHE_MODE_ARGUMENT,
  resolvePromptCacheMode,
  type PromptCacheMode,
} from './cache';
import {
  calculateNetSavedTokens,
  loadCacheLedger,
  resetCacheLedger,
  type CacheLedger,
} from './ledger';
import {
  CONFIGURABLE_LLM_FLAG_NAMES,
  DEFAULT_MODEL,
  FLAGS_ARGUMENT,
  MODEL_ARGUMENT,
  MODEL_OPTIONS,
  REASONING_EFFORT_ARGUMENT,
  REASONING_EFFORT_OPTIONS,
  SERVICE_TIER_ARGUMENT,
  STREAMING_MODE_ARGUMENT,
  UNSUPPORTED_MEDIA_LLM_FLAG_NAMES,
  VERBOSITY_ARGUMENT,
  VERBOSITY_OPTIONS,
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
  type UnsupportedMediaLlmFlagName,
  type Verbosity,
} from './options';
import { applyTheme, resolveScheme } from './theme';

const API_KEY_ARGUMENT = 'api_key';

interface FlagOption {
  label: string;
  name: ConfigurableLlmFlagName;
}

const FLAG_OPTIONS: readonly FlagOption[] = [
  { label: 'Full System Prompt', name: 'hasFullSystemPrompt' },
  { label: 'First System Prompt', name: 'hasFirstSystemPrompt' },
  { label: 'Alternate Role', name: 'requiresAlternateRole' },
  { label: 'Must Start With User', name: 'mustStartWithUserInput' },
  { label: 'Pool Supported', name: 'poolSupported' },
];

const UNSUPPORTED_MEDIA_FLAG_LABELS: Record<UnsupportedMediaLlmFlagName, string> = {
  hasImageInput: 'Image Input',
  hasImageOutput: 'Image Output',
  hasAudioInput: 'Audio Input',
  hasAudioOutput: 'Audio Output',
  hasVideoInput: 'Video Input',
};

export interface ProviderRegistrationSettings {
  flagNames: readonly ConfigurableLlmFlagName[];
  streamingMode: StreamingMode;
}

export async function loadApiKey(): Promise<string> {
  const value = await risuai.getArgument(API_KEY_ARGUMENT);
  if (value === undefined) return '';
  if (typeof value !== 'string') {
    throw new TypeError('api_key argument must be a string');
  }
  return value;
}

export async function saveApiKey(value: string): Promise<void> {
  await risuai.setArgument(API_KEY_ARGUMENT, value);
}

export async function loadPromptCacheMode(): Promise<PromptCacheMode> {
  const value = await risuai.getArgument(PROMPT_CACHE_MODE_ARGUMENT);
  if (value === undefined) return 'disabled';
  if (typeof value !== 'string') {
    throw new TypeError('prompt_cache_mode argument must be a string');
  }
  return resolvePromptCacheMode(value);
}

export async function savePromptCacheMode(value: PromptCacheMode): Promise<void> {
  await risuai.setArgument(PROMPT_CACHE_MODE_ARGUMENT, value);
}

export async function loadModel(): Promise<string> {
  const value = await risuai.getArgument(MODEL_ARGUMENT);
  if (value === undefined) return DEFAULT_MODEL;
  if (typeof value !== 'string') {
    throw new TypeError('model argument must be a string');
  }
  const trimmed = value.trim();
  return trimmed === '' ? DEFAULT_MODEL : trimmed;
}

export async function saveModel(value: string): Promise<void> {
  await risuai.setArgument(MODEL_ARGUMENT, value);
}

export async function loadServiceTier(): Promise<ServiceTier> {
  const value = await risuai.getArgument(SERVICE_TIER_ARGUMENT);
  if (value === undefined) return 'default';
  if (typeof value !== 'string') {
    throw new TypeError('service_tier argument must be a string');
  }
  return resolveServiceTier(value) ?? 'default';
}

export async function saveServiceTier(value: ServiceTier): Promise<void> {
  await risuai.setArgument(SERVICE_TIER_ARGUMENT, value);
}

export async function loadReasoningEffort(): Promise<ReasoningEffort | undefined> {
  const value = await risuai.getArgument(REASONING_EFFORT_ARGUMENT);
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new TypeError('reasoning_effort argument must be a string');
  }
  return resolveReasoningEffort(value);
}

export async function saveReasoningEffort(value: ReasoningEffort | undefined): Promise<void> {
  await risuai.setArgument(REASONING_EFFORT_ARGUMENT, value ?? '');
}

export async function loadVerbosity(): Promise<Verbosity | undefined> {
  const value = await risuai.getArgument(VERBOSITY_ARGUMENT);
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new TypeError('verbosity argument must be a string');
  }
  return resolveVerbosity(value);
}

export async function saveVerbosity(value: Verbosity | undefined): Promise<void> {
  await risuai.setArgument(VERBOSITY_ARGUMENT, value ?? '');
}

export async function loadStreamingMode(): Promise<StreamingMode> {
  const value = await risuai.getArgument(STREAMING_MODE_ARGUMENT);
  if (value === undefined) return 'off';
  if (typeof value !== 'string') {
    throw new TypeError('streaming_mode argument must be a string');
  }
  return resolveStreamingMode(value);
}

export async function saveStreamingMode(value: StreamingMode): Promise<void> {
  await risuai.setArgument(STREAMING_MODE_ARGUMENT, value);
}

export async function loadConfigurableLlmFlagNames(): Promise<readonly ConfigurableLlmFlagName[]> {
  const value = await risuai.getArgument(FLAGS_ARGUMENT);
  if (value === undefined) return resolveConfigurableLlmFlagNames(undefined);
  if (typeof value !== 'string') {
    throw new TypeError('flags argument must be a string');
  }
  return resolveConfigurableLlmFlagNames(value);
}

export async function saveConfigurableLlmFlagNames(
  flagNames: readonly ConfigurableLlmFlagName[],
): Promise<void> {
  await risuai.setArgument(FLAGS_ARGUMENT, serializeConfigurableLlmFlagNames(flagNames));
}

export interface SettingsValues {
  apiKey: string;
  flagNames: readonly ConfigurableLlmFlagName[];
  model: string;
  promptCacheMode: PromptCacheMode;
  reasoningEffort: ReasoningEffort | undefined;
  serviceTier: ServiceTier;
  streamingMode: StreamingMode;
  verbosity: Verbosity | undefined;
}

export async function saveSettings(values: SettingsValues): Promise<void> {
  await Promise.all([
    saveApiKey(values.apiKey),
    saveModel(values.model),
    savePromptCacheMode(values.promptCacheMode),
    saveServiceTier(values.serviceTier),
    saveReasoningEffort(values.reasoningEffort),
    saveVerbosity(values.verbosity),
    saveStreamingMode(values.streamingMode),
    saveConfigurableLlmFlagNames(values.flagNames),
  ]);
}

const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => HTML_ESCAPE_MAP[character]);
}

function requireApiKeyInput(): HTMLInputElement {
  const element = document.getElementById('api-key');
  if (!(element instanceof HTMLInputElement)) {
    throw new Error('API key input was not rendered');
  }
  return element;
}

function requireCheckbox(id: string): HTMLInputElement {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLInputElement) || element.type !== 'checkbox') {
    throw new Error(`${id} checkbox was not rendered`);
  }
  return element;
}

function requireSelect(id: string): HTMLSelectElement {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLSelectElement)) {
    throw new Error(`${id} select was not rendered`);
  }
  return element;
}

function requireButton(id: string): HTMLButtonElement {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLButtonElement)) {
    throw new Error(`${id} button was not rendered`);
  }
  return element;
}

function requireSettingsForm(): HTMLFormElement {
  const element = document.getElementById('settings-form');
  if (!(element instanceof HTMLFormElement)) {
    throw new Error('Settings form was not rendered');
  }
  return element;
}

function requireLedgerSummary(): HTMLElement {
  const element = document.getElementById('ledger-summary');
  if (!(element instanceof HTMLElement)) {
    throw new Error('Ledger summary was not rendered');
  }
  return element;
}

function requireReloadNotice(): HTMLElement {
  const element = document.getElementById('reload-notice');
  if (!(element instanceof HTMLElement)) {
    throw new Error('Reload notice was not rendered');
  }
  return element;
}

interface FlagInput {
  input: HTMLInputElement;
  name: ConfigurableLlmFlagName;
}

interface SettingsFormElements {
  apiKeyInput: HTMLInputElement;
  flagInputs: readonly FlagInput[];
  modelSelect: HTMLSelectElement;
  promptCacheModeSelect: HTMLSelectElement;
  reasoningEffortSelect: HTMLSelectElement;
  serviceTierSelect: HTMLSelectElement;
  streamingModeSelect: HTMLSelectElement;
  verbositySelect: HTMLSelectElement;
}

function readSelectedFlagNames(
  flagInputs: readonly FlagInput[],
): readonly ConfigurableLlmFlagName[] {
  return flagInputs.filter((flagInput) => flagInput.input.checked).map((flagInput) => flagInput.name);
}

export function createProviderRegistrationSignature(
  settings: ProviderRegistrationSettings,
): string {
  const sortedFlagNames = [...settings.flagNames].sort();
  return `${settings.streamingMode}:${serializeConfigurableLlmFlagNames(sortedFlagNames)}`;
}

async function saveFromForm(
  elements: SettingsFormElements,
  button: HTMLButtonElement,
  reloadNotice: HTMLElement,
  registeredSignature: string,
): Promise<void> {
  button.disabled = true;
  button.textContent = '저장 중...';

  const values: SettingsValues = {
    apiKey: elements.apiKeyInput.value,
    flagNames: readSelectedFlagNames(elements.flagInputs),
    model: elements.modelSelect.value,
    promptCacheMode: resolvePromptCacheMode(elements.promptCacheModeSelect.value),
    reasoningEffort: resolveReasoningEffort(elements.reasoningEffortSelect.value),
    serviceTier: resolveServiceTier(elements.serviceTierSelect.value) ?? 'default',
    streamingMode: resolveStreamingMode(elements.streamingModeSelect.value),
    verbosity: resolveVerbosity(elements.verbositySelect.value),
  };

  try {
    await saveSettings(values);
    button.textContent = '저장됨';
    // addProvider metadata와 streaming 동작은 플러그인 로드 때 한 번 고정되므로
    // 저장값이 등록 스냅샷과 달라지면 재등록이 필요하다는 사실을 즉시 알린다.
    reloadNotice.hidden = createProviderRegistrationSignature(values) === registeredSignature;
  } catch (error) {
    button.textContent = '저장 실패';
    console.error('[llm-gateway-provider] Failed to save settings', error);
  } finally {
    button.disabled = false;
  }
}

export function formatTokenCount(value: number): string {
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (absolute >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return `${value}`;
}

// 입력 정가 토큰 등가 기준 순절감 요약. 원시 읽기/쓰기도 함께 보여줘
// 손익 공식(0.9R − 0.25W)을 검산할 수 있게 한다.
export function formatLedgerSummary(ledger: CacheLedger): string {
  if (ledger.readTokens === 0 && ledger.writeTokens === 0 && ledger.costUsd === 0) {
    return '캐시 손익: 아직 기록 없음';
  }

  const netSavedTokens = calculateNetSavedTokens(ledger);
  const sign = netSavedTokens >= 0 ? '+' : '';
  const costSummary = ledger.costUsd === 0 ? '' : ` · 지출 $${ledger.costUsd.toFixed(4)}`;
  return (
    `캐시 손익: ${sign}${formatTokenCount(netSavedTokens)} tokens${costSummary}` +
    ` (읽기 ${formatTokenCount(ledger.readTokens)} / 쓰기 ${formatTokenCount(ledger.writeTokens)})`
  );
}

// 인자 편집 화면에서 직접 입력한 커스텀 모델 ID도 select에서 유실되지 않게 옵션으로 노출한다.
export function buildModelOptionList(currentModel: string): readonly string[] {
  return MODEL_OPTIONS.includes(currentModel) ? MODEL_OPTIONS : [currentModel, ...MODEL_OPTIONS];
}

function renderModelOptionsHtml(currentModel: string): string {
  return buildModelOptionList(currentModel)
    .map((model) => `<option value="${escapeHtml(model)}">${escapeHtml(model)}</option>`)
    .join('');
}

function renderReasoningEffortOptionsHtml(): string {
  return REASONING_EFFORT_OPTIONS
    .map((effort) => `<option value="${effort}">${effort}</option>`)
    .join('');
}

function renderVerbosityOptionsHtml(): string {
  return VERBOSITY_OPTIONS
    .map((verbosity) => `<option value="${verbosity}">${verbosity}</option>`)
    .join('');
}

function renderFlagOptionsHtml(): string {
  const configurable = FLAG_OPTIONS
    .map((option) =>
      `<label class="checkbox"><input id="flag-${option.name}" type="checkbox">` +
      `<span>${option.label}</span></label>`,
    )
    .join('');
  // convert.ts는 현재 텍스트만 보존한다. 미디어 flag를 켜면 입력이 조용히 유실되므로
  // 멀티모달 변환을 구현할 때까지 설정 자체를 활성화하지 않는다.
  const unsupportedMedia = UNSUPPORTED_MEDIA_LLM_FLAG_NAMES
    .map((flagName) =>
      '<label class="checkbox unsupported"><input type="checkbox" disabled>' +
      `<span>${UNSUPPORTED_MEDIA_FLAG_LABELS[flagName]} · 미지원</span></label>`,
    )
    .join('');
  return configurable + unsupportedMedia;
}

export function createSettingsHtml(currentModel: string): string {
  return (
    '<main id="app">' +
      '<form id="settings-form">' +
        '<input id="api-key" type="password" aria-label="API key" placeholder="API key" autocomplete="off" spellcheck="false">' +
        '<select id="model" aria-label="모델">' +
          renderModelOptionsHtml(currentModel) +
        '</select>' +
        '<select id="reasoning-effort" aria-label="Reasoning effort">' +
          '<option value="">Reasoning effort · 지정 안 함</option>' +
          renderReasoningEffortOptionsHtml() +
        '</select>' +
        '<select id="verbosity" aria-label="Verbosity">' +
          '<option value="">Verbosity · 지정 안 함</option>' +
          renderVerbosityOptionsHtml() +
        '</select>' +
        '<select id="streaming-mode" aria-label="스트리밍 모드">' +
          '<option value="off">스트리밍 끄기</option>' +
          '<option value="decoupled">분리 스트리밍</option>' +
          '<option value="stream">실시간 스트리밍</option>' +
        '</select>' +
        '<select id="prompt-cache-mode" aria-label="프롬프트 캐시 모드">' +
          '<option value="explicit">명시적 캐시 사용</option>' +
          '<option value="disabled">캐시 끄기</option>' +
        '</select>' +
        '<select id="service-tier" aria-label="서비스 티어">' +
          '<option value="default">스탠다드 티어</option>' +
          '<option value="flex">Flex 티어</option>' +
        '</select>' +
        '<fieldset class="flags">' +
          '<legend>LLM flags</legend>' +
          renderFlagOptionsHtml() +
          '<p class="help">미디어 입출력은 텍스트 전용 변환 때문에 현재 미지원입니다.</p>' +
        '</fieldset>' +
        '<p id="reload-notice" class="notice" hidden>적용하려면 새로고침이 필요합니다.</p>' +
        '<div class="ledger">' +
          '<span id="ledger-summary"></span>' +
          '<button id="ledger-reset" type="button" aria-label="캐시 손익 초기화">🗑</button>' +
        '</div>' +
        '<div class="actions">' +
          '<button id="save" type="submit">저장</button>' +
          '<button id="close" type="button">닫기</button>' +
        '</div>' +
      '</form>' +
    '</main>'
  );
}

function renderSettings(currentModel: string): void {
  if (!document.getElementById('llm-gateway-styles')) {
    const style = document.createElement('style');
    style.id = 'llm-gateway-styles';
    style.textContent = STYLES;
    document.head.appendChild(style);
  }

  document.body.innerHTML = createSettingsHtml(currentModel);
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
  ] = await Promise.all([
    loadApiKey(),
    loadModel(),
    loadPromptCacheMode(),
    loadServiceTier(),
    loadReasoningEffort(),
    loadVerbosity(),
    loadStreamingMode(),
    loadConfigurableLlmFlagNames(),
  ]);

  renderSettings(model);
  applyTheme(await resolveScheme());

  const flagInputs = CONFIGURABLE_LLM_FLAG_NAMES.map((flagName) => ({
    input: requireCheckbox(`flag-${flagName}`),
    name: flagName,
  }));
  const elements: SettingsFormElements = {
    apiKeyInput: requireApiKeyInput(),
    flagInputs,
    modelSelect: requireSelect('model'),
    promptCacheModeSelect: requireSelect('prompt-cache-mode'),
    reasoningEffortSelect: requireSelect('reasoning-effort'),
    serviceTierSelect: requireSelect('service-tier'),
    streamingModeSelect: requireSelect('streaming-mode'),
    verbositySelect: requireSelect('verbosity'),
  };
  const saveButton = requireButton('save');
  const closeButton = requireButton('close');
  const ledgerResetButton = requireButton('ledger-reset');
  const ledgerSummary = requireLedgerSummary();
  const reloadNotice = requireReloadNotice();
  const form = requireSettingsForm();

  elements.apiKeyInput.value = apiKey;
  elements.modelSelect.value = model;
  elements.promptCacheModeSelect.value = promptCacheMode;
  elements.reasoningEffortSelect.value = reasoningEffort ?? '';
  elements.serviceTierSelect.value = serviceTier;
  elements.streamingModeSelect.value = streamingMode;
  elements.verbositySelect.value = verbosity ?? '';
  for (const flagInput of flagInputs) {
    flagInput.input.checked = flagNames.includes(flagInput.name);
  }
  elements.apiKeyInput.focus();

  ledgerSummary.textContent = formatLedgerSummary(await loadCacheLedger());
  const registeredSignature = createProviderRegistrationSignature(registrationSettings);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void saveFromForm(elements, saveButton, reloadNotice, registeredSignature);
  });
  ledgerResetButton.addEventListener('click', () => {
    void resetLedgerFromForm(ledgerSummary, ledgerResetButton);
  });
  closeButton.addEventListener('click', () => {
    void risuai.hideContainer();
  });
}

async function resetLedgerFromForm(
  summary: HTMLElement,
  button: HTMLButtonElement,
): Promise<void> {
  button.disabled = true;

  try {
    await resetCacheLedger();
    summary.textContent = formatLedgerSummary(await loadCacheLedger());
  } catch (error) {
    summary.textContent = '캐시 손익: 초기화 실패';
    console.error('[llm-gateway-provider] Failed to reset cache ledger', error);
  } finally {
    button.disabled = false;
  }
}
