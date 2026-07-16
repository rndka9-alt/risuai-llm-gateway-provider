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


// streaming_mode는 요청 시 라이브로 읽혀 등록과 무관하므로, 재등록(새로고침)이
// 필요한 항목은 addProvider 시점에 굳는 flags뿐이다.
export interface ProviderRegistrationSettings {
  flagNames: readonly ConfigurableLlmFlagName[];
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

export async function loadServiceTier(): Promise<ServiceTier | undefined> {
  const value = await risuai.getArgument(SERVICE_TIER_ARGUMENT);
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new TypeError('service_tier argument must be a string');
  }
  return resolveServiceTier(value);
}

export async function saveServiceTier(value: ServiceTier | undefined): Promise<void> {
  await risuai.setArgument(SERVICE_TIER_ARGUMENT, value === 'flex' ? 'flex' : '');
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
  serviceTier: ServiceTier | undefined;
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
  serviceTierInput: HTMLInputElement;
  streamingModeInput: HTMLInputElement;
  verbositySelect: HTMLSelectElement;
}

function readSelectedFlagNames(
  flagInputs: readonly FlagInput[],
): readonly ConfigurableLlmFlagName[] {
  return flagInputs.filter((flagInput) => flagInput.input.checked).map((flagInput) => flagInput.name);
}

function resolveServiceTierInput(input: HTMLInputElement): ServiceTier | undefined {
  return input.checked ? 'flex' : undefined;
}

function renderServiceTierLabel(input: HTMLInputElement, label: HTMLElement): void {
  label.textContent = input.checked ? 'Flex' : 'Gateway 기본';
}

function resolveStreamingModeInput(input: HTMLInputElement): StreamingMode {
  return input.checked ? 'decoupled' : 'off';
}

function renderStreamingModeLabel(input: HTMLInputElement, label: HTMLElement): void {
  label.textContent = input.checked ? '스트리밍 연결 · 완료 후 표시' : '일반 요청';
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

export interface LedgerDisplay {
  amountText: string;
  tone: 'gain' | 'loss' | 'neutral';
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
        '<div class="settings-content">' +
          '<div class="field">' +
            '<label class="field-caption" for="api-key">API 키</label>' +
            '<div class="secret-control">' +
              '<input id="api-key" type="password" aria-label="API key" autocomplete="off" spellcheck="false">' +
              '<button id="api-key-visibility" class="visibility-toggle" type="button" aria-label="API 키 표시" aria-pressed="false">' +
                '<svg viewBox="0 0 24 24" aria-hidden="true">' +
                  '<path d="M2.5 12c2.1-3.8 5.2-6 9.5-6s7.4 2.2 9.5 6c-2.1 3.8-5.2 6-9.5 6S4.6 15.8 2.5 12Z"></path>' +
                  '<circle cx="12" cy="12" r="2.75"></circle>' +
                  '<path class="eye-slash" d="m4 4 16 16"></path>' +
                '</svg>' +
              '</button>' +
            '</div>' +
          '</div>' +
          '<div class="field cache-mode-field">' +
            '<label class="field-caption" for="prompt-cache-mode">캐시 모드</label>' +
            '<select id="prompt-cache-mode" aria-label="프롬프트 캐시 모드">' +
              '<option value="explicit">명시적 캐시 사용</option>' +
              '<option value="disabled">캐시 끄기</option>' +
            '</select>' +
          '</div>' +
          '<div class="field">' +
            '<label class="field-caption" for="reasoning-effort">Reasoning effort</label>' +
            '<select id="reasoning-effort" aria-label="Reasoning effort">' +
              '<option value="">지정 안 함</option>' +
              renderReasoningEffortOptionsHtml() +
            '</select>' +
          '</div>' +
          '<div class="field">' +
            '<label class="field-caption" for="verbosity">Verbosity</label>' +
            '<select id="verbosity" aria-label="Verbosity">' +
              '<option value="">지정 안 함</option>' +
              renderVerbosityOptionsHtml() +
            '</select>' +
          '</div>' +
          '<div class="field">' +
            '<span class="field-caption-row">' +
              '<span class="field-caption">응답 방식</span>' +
              '<span class="help-tooltip">' +
                '<button class="help-tooltip-trigger" type="button" aria-label="응답 방식 도움말" aria-describedby="streaming-mode-tooltip">' +
                  '<span aria-hidden="true">ⓘ</span>' +
                '</button>' +
                '<span id="streaming-mode-tooltip" class="help-tooltip-content" role="tooltip">' +
                  '응답 데이터를 조각 단위로 실시간 수신합니다. 플러그인이 모두 조립한 뒤 RisuAI에 한 번에 전달합니다.' +
                '</span>' +
              '</span>' +
            '</span>' +
            '<label class="toggle-control" for="streaming-mode">' +
              '<span id="streaming-mode-label">일반 요청</span>' +
              '<input id="streaming-mode" class="switch-input" type="checkbox" role="switch" aria-label="응답 방식">' +
              '<span class="switch-track" aria-hidden="true"><span class="switch-knob"></span></span>' +
            '</label>' +
          '</div>' +
          '<div class="advanced-divider"><span>고급</span></div>' +
          '<div class="field">' +
            '<label class="field-caption" for="model">모델</label>' +
            '<select id="model" aria-label="모델">' +
              renderModelOptionsHtml(currentModel) +
            '</select>' +
          '</div>' +
          '<div class="field">' +
            '<span class="field-caption-row">' +
              '<span class="field-caption">서비스 티어</span>' +
              '<span class="help-tooltip">' +
                '<button class="help-tooltip-trigger" type="button" aria-label="Flex 서비스 티어 도움말" aria-describedby="service-tier-tooltip">' +
                  '<span aria-hidden="true">ⓘ</span>' +
                '</button>' +
                '<span id="service-tier-tooltip" class="help-tooltip-content" role="tooltip">' +
                  '입력·출력 비용이 절반으로 줄어듭니다. 대신 서버 상황에 따라 응답이 늦어지거나 실패할 수 있습니다.' +
                '</span>' +
              '</span>' +
            '</span>' +
            '<label class="toggle-control" for="service-tier">' +
              '<span id="service-tier-label">Gateway 기본</span>' +
              '<input id="service-tier" class="switch-input" type="checkbox" role="switch" aria-label="Flex 서비스 티어 사용">' +
              '<span class="switch-track" aria-hidden="true"><span class="switch-knob"></span></span>' +
            '</label>' +
          '</div>' +
          '<div class="field">' +
            '<span id="llm-flags-label" class="field-caption">LLM flags</span>' +
            '<fieldset class="flags" aria-labelledby="llm-flags-label">' +
              renderFlagOptionsHtml() +
            '</fieldset>' +
          '</div>' +
          '<p id="reload-notice" class="notice" hidden>적용하려면 새로고침이 필요합니다.</p>' +
          '<p id="save-error" class="notice" hidden>저장에 실패했어요 — 콘솔을 확인해주세요.</p>' +
          '<p id="cache-backoff-diagnostic" class="cache-diagnostic" hidden>' +
            '⚠️ 프롬프트 앞부분이 매턴 바뀌어 캐시를 일시 중단했어요. ' +
            '프리셋의 {{time}}/{{random}}/확률 로어북을 확인해보세요' +
          '</p>' +
        '</div>' +
        '<footer class="settings-footer">' +
          '<div id="ledger" class="ledger">' +
            '<button id="ledger-summary" class="ledger-trigger" type="button" aria-label="캐시 손익 상세" aria-describedby="ledger-popover">' +
              '<span id="ledger-amount-summary" class="amount neutral"></span>' +
              '<span class="info-icon" aria-hidden="true">ⓘ</span>' +
            '</button>' +
            '<button id="ledger-reset" class="ledger-reset" type="button" aria-label="캐시 손익 초기화" title="캐시 손익 초기화">×</button>' +
            '<div id="ledger-popover" class="ledger-popover" role="tooltip">' +
              '<div id="ledger-detail" class="ledger-detail">' +
                '<div class="ledger-row"><span>읽기</span><span id="ledger-read-detail">0</span></div>' +
                '<div class="ledger-row"><span>쓰기</span><span id="ledger-write-detail">0</span></div>' +
                '<div class="ledger-row ledger-result"><span>캐시 손익</span><span id="ledger-amount"></span></div>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<button id="close" class="close-button" type="button">닫기</button>' +
        '</footer>' +
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
    serviceTierInput: requireCheckbox('service-tier'),
    streamingModeInput: requireCheckbox('streaming-mode'),
    verbositySelect: requireSelect('verbosity'),
  };
  const apiKeyVisibilityButton = requireButton('api-key-visibility');
  const closeButton = requireButton('close');
  const ledgerResetButton = requireButton('ledger-reset');
  const ledgerElements: LedgerElements = {
    amount: requireElement('ledger-amount'),
    amountSummary: requireElement('ledger-amount-summary'),
    readDetail: requireElement('ledger-read-detail'),
    writeDetail: requireElement('ledger-write-detail'),
  };
  const cacheBackoffDiagnostic = requireElement('cache-backoff-diagnostic');
  const reloadNotice = requireElement('reload-notice');
  const saveErrorNotice = requireElement('save-error');
  const serviceTierLabel = requireElement('service-tier-label');
  const streamingModeLabel = requireElement('streaming-mode-label');
  const form = requireSettingsForm();

  elements.apiKeyInput.value = apiKey;
  elements.modelSelect.value = model;
  elements.promptCacheModeSelect.value = promptCacheMode;
  elements.reasoningEffortSelect.value = reasoningEffort ?? '';
  elements.serviceTierInput.checked = serviceTier === 'flex';
  renderServiceTierLabel(elements.serviceTierInput, serviceTierLabel);
  elements.streamingModeInput.checked = streamingMode === 'decoupled';
  renderStreamingModeLabel(elements.streamingModeInput, streamingModeLabel);
  elements.verbositySelect.value = verbosity ?? '';
  for (const flagInput of flagInputs) {
    flagInput.input.checked = flagNames.includes(flagInput.name);
  }

  renderLedger(ledgerElements, cacheLedger);
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

  // addProvider metadata(flags)는 플러그인 로드 때 한 번 고정되므로
  // 등록 스냅샷과 달라지는 즉시 재등록(새로고침) 필요를 알린다.
  const updateReloadNotice = (): void => {
    const currentSignature = createProviderRegistrationSignature({
      flagNames: readSelectedFlagNames(flagInputs),
    });
    reloadNotice.hidden = currentSignature === registeredSignature;
  };

  apiKeyVisibilityButton.addEventListener('click', () => {
    const revealApiKey = elements.apiKeyInput.type === 'password';
    elements.apiKeyInput.type = revealApiKey ? 'text' : 'password';
    apiKeyVisibilityButton.setAttribute('aria-pressed', String(revealApiKey));
    apiKeyVisibilityButton.setAttribute('aria-label', revealApiKey ? 'API 키 숨기기' : 'API 키 표시');
  });
  elements.apiKeyInput.addEventListener('change', () => {
    persist(() => saveApiKey(elements.apiKeyInput.value));
  });
  elements.modelSelect.addEventListener('change', () => {
    persist(() => saveModel(elements.modelSelect.value));
  });
  elements.promptCacheModeSelect.addEventListener('change', () => {
    persist(() => savePromptCacheMode(resolvePromptCacheMode(elements.promptCacheModeSelect.value)));
  });
  elements.serviceTierInput.addEventListener('change', () => {
    renderServiceTierLabel(elements.serviceTierInput, serviceTierLabel);
    persist(() => saveServiceTier(resolveServiceTierInput(elements.serviceTierInput)));
  });
  elements.reasoningEffortSelect.addEventListener('change', () => {
    persist(() => saveReasoningEffort(resolveReasoningEffort(elements.reasoningEffortSelect.value)));
  });
  elements.verbositySelect.addEventListener('change', () => {
    persist(() => saveVerbosity(resolveVerbosity(elements.verbositySelect.value)));
  });
  elements.streamingModeInput.addEventListener('change', () => {
    renderStreamingModeLabel(elements.streamingModeInput, streamingModeLabel);
    persist(() => saveStreamingMode(resolveStreamingModeInput(elements.streamingModeInput)));
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
    void resetLedgerFromForm(ledgerElements, ledgerResetButton);
  });
  closeButton.addEventListener('click', () => {
    void risuai.hideContainer();
  });
}

// 요약과 팝오버가 항상 같은 원장 스냅샷을 표시하도록 갱신 대상을 한 묶음으로 전달한다.
interface LedgerElements {
  amount: HTMLElement;
  amountSummary: HTMLElement;
  readDetail: HTMLElement;
  writeDetail: HTMLElement;
}

function renderLedger(elements: LedgerElements, ledger: CacheLedger): void {
  const display = buildLedgerDisplay(ledger);
  // 상시 노출은 대표 손익 금액 하나 — 색과 부호만으로 읽히므로 라벨은 팝오버에만 둔다.
  elements.amountSummary.textContent = display.amountText;
  elements.amountSummary.className = `amount ${display.tone}`;
  elements.readDetail.textContent = formatTokenCount(ledger.readTokens);
  elements.writeDetail.textContent = formatTokenCount(ledger.writeTokens);
  elements.amount.textContent = display.amountText;
  elements.amount.className = `amount ${display.tone}`;
}

async function resetLedgerFromForm(
  elements: LedgerElements,
  button: HTMLButtonElement,
): Promise<void> {
  button.disabled = true;

  try {
    await resetCacheLedger();
    renderLedger(elements, await loadCacheLedger());
  } catch (error) {
    elements.amount.textContent = '초기화 실패';
    elements.amount.className = 'amount loss';
    console.error('[llm-gateway-provider] Failed to reset cache ledger', error);
  } finally {
    button.disabled = false;
  }
}
