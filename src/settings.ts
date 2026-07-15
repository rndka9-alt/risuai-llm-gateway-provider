import { STYLES } from './constants';
import {
  PROMPT_CACHE_MODE_ARGUMENT,
  isCacheBackoffActive,
  loadCacheAnchorState,
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
  if (value === undefined) return 'explicit';
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

function requireElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`${id} element was not rendered`);
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

export function formatTokenCount(value: number): string {
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (absolute >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return `${value}`;
}

export interface LedgerDisplay {
  amountText: string;
  detailText: string;
  tone: 'gain' | 'loss' | 'neutral';
}

// 손익을 대표값 하나로 보여준다 — 실측 절감 USD가 있으면 그것을, 없으면
// 입력 정가 토큰 등가(0.9R − 0.25W)를 쓴다. 원시 읽기/쓰기는 검산용 디테일로.
export function buildLedgerDisplay(ledger: CacheLedger): LedgerDisplay {
  const hasRecords =
    ledger.readTokens !== 0 ||
    ledger.writeTokens !== 0 ||
    ledger.costUsd !== 0 ||
    ledger.savedUsd !== 0;
  if (!hasRecords) {
    return { amountText: '아직 기록 없음', detailText: '', tone: 'neutral' };
  }

  const useUsd = ledger.savedUsd !== 0;
  const amountValue = useUsd ? ledger.savedUsd : calculateNetSavedTokens(ledger);
  const sign = amountValue >= 0 ? '+' : '-';
  const absolute = Math.abs(amountValue);
  const amountText = useUsd
    ? `${sign}$${absolute.toFixed(4)}`
    : `${sign}${formatTokenCount(absolute)} tokens`;

  const detailParts = [
    `읽기 ${formatTokenCount(ledger.readTokens)}`,
    `쓰기 ${formatTokenCount(ledger.writeTokens)}`,
  ];
  if (ledger.costUsd !== 0) detailParts.push(`지출 $${ledger.costUsd.toFixed(4)}`);

  return {
    amountText,
    detailText: `(${detailParts.join(' / ')})`,
    tone: amountValue >= 0 ? 'gain' : 'loss',
  };
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
  // 미디어 항목 중 Image Input만 대표로 노출해 로드맵을 암시한다.
  const unsupportedMedia =
    '<label class="checkbox unsupported"><input type="checkbox" disabled>' +
    '<span>Image Input · 미지원</span></label>';
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
        '</fieldset>' +
        '<p id="reload-notice" class="notice" hidden>적용하려면 새로고침이 필요합니다.</p>' +
        '<p id="save-error" class="notice" hidden>저장에 실패했어요 — 콘솔을 확인해주세요.</p>' +
        '<div class="ledger">' +
          '<span>캐시 손익:</span>' +
          '<span id="ledger-amount"></span>' +
          '<button id="ledger-reset" type="button" aria-label="캐시 손익 초기화">×</button>' +
          '<span id="ledger-detail"></span>' +
        '</div>' +
        '<p id="cache-backoff-diagnostic" class="cache-diagnostic" hidden>' +
          '⚠️ 프롬프트 앞부분이 매턴 바뀌어 캐시를 일시 중단했어요. ' +
          '프리셋의 {{time}}/{{random}}/확률 로어북을 확인해보세요' +
        '</p>' +
        '<div class="actions">' +
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
    cacheAnchorState,
    cacheLedger,
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
    loadCacheLedger(),
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
  const closeButton = requireButton('close');
  const ledgerResetButton = requireButton('ledger-reset');
  const ledgerAmount = requireElement('ledger-amount');
  const ledgerDetail = requireElement('ledger-detail');
  const cacheBackoffDiagnostic = requireElement('cache-backoff-diagnostic');
  const reloadNotice = requireElement('reload-notice');
  const saveErrorNotice = requireElement('save-error');
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

  renderLedger(ledgerAmount, ledgerDetail, cacheLedger);
  cacheBackoffDiagnostic.hidden = !isCacheBackoffActive(cacheAnchorState);
  const registeredSignature = createProviderRegistrationSignature(registrationSettings);

  // 프로바이더가 매 요청 인자를 라이브로 읽으므로 변경 즉시 저장해도 다음
  // 요청부터 반영된다 — 저장 버튼 없이 change 시점에 곧바로 저장한다.
  const persist = (save: () => Promise<void>): void => {
    save().then(
      () => {
        saveErrorNotice.hidden = true;
      },
      (error: unknown) => {
        saveErrorNotice.hidden = false;
        console.error('[llm-gateway-provider] Failed to save settings', error);
      },
    );
  };

  // addProvider metadata와 streaming 동작은 플러그인 로드 때 한 번 고정되므로
  // 등록 스냅샷과 달라지는 즉시 재등록(새로고침) 필요를 알린다.
  const updateReloadNotice = (): void => {
    const currentSignature = createProviderRegistrationSignature({
      flagNames: readSelectedFlagNames(flagInputs),
      streamingMode: resolveStreamingMode(elements.streamingModeSelect.value),
    });
    reloadNotice.hidden = currentSignature === registeredSignature;
  };

  elements.apiKeyInput.addEventListener('change', () => {
    persist(() => saveApiKey(elements.apiKeyInput.value));
  });
  elements.modelSelect.addEventListener('change', () => {
    persist(() => saveModel(elements.modelSelect.value));
  });
  elements.promptCacheModeSelect.addEventListener('change', () => {
    persist(() => savePromptCacheMode(resolvePromptCacheMode(elements.promptCacheModeSelect.value)));
  });
  elements.serviceTierSelect.addEventListener('change', () => {
    persist(() => saveServiceTier(resolveServiceTier(elements.serviceTierSelect.value) ?? 'default'));
  });
  elements.reasoningEffortSelect.addEventListener('change', () => {
    persist(() => saveReasoningEffort(resolveReasoningEffort(elements.reasoningEffortSelect.value)));
  });
  elements.verbositySelect.addEventListener('change', () => {
    persist(() => saveVerbosity(resolveVerbosity(elements.verbositySelect.value)));
  });
  elements.streamingModeSelect.addEventListener('change', () => {
    updateReloadNotice();
    persist(() => saveStreamingMode(resolveStreamingMode(elements.streamingModeSelect.value)));
  });
  for (const flagInput of flagInputs) {
    flagInput.input.addEventListener('change', () => {
      updateReloadNotice();
      persist(() => saveConfigurableLlmFlagNames(readSelectedFlagNames(flagInputs)));
    });
  }

  // 저장 버튼이 없으므로 Enter 키의 기본 submit(페이지 이동)만 막는다.
  form.addEventListener('submit', (event) => {
    event.preventDefault();
  });
  ledgerResetButton.addEventListener('click', () => {
    void resetLedgerFromForm(ledgerAmount, ledgerDetail, ledgerResetButton);
  });
  closeButton.addEventListener('click', () => {
    void risuai.hideContainer();
  });
}

function renderLedger(
  amountElement: HTMLElement,
  detailElement: HTMLElement,
  ledger: CacheLedger,
): void {
  const display = buildLedgerDisplay(ledger);
  amountElement.textContent = display.amountText;
  amountElement.className = `amount ${display.tone}`;
  detailElement.textContent = display.detailText;
}

async function resetLedgerFromForm(
  amountElement: HTMLElement,
  detailElement: HTMLElement,
  button: HTMLButtonElement,
): Promise<void> {
  button.disabled = true;

  try {
    await resetCacheLedger();
    renderLedger(amountElement, detailElement, await loadCacheLedger());
  } catch (error) {
    amountElement.textContent = '초기화 실패';
    amountElement.className = 'amount loss';
    console.error('[llm-gateway-provider] Failed to reset cache ledger', error);
  } finally {
    button.disabled = false;
  }
}
