import { STYLES } from './constants';
import {
  PROMPT_CACHE_MODE_ARGUMENT,
  resolvePromptCacheMode,
  type PromptCacheMode,
} from './cache';
import {
  DEFAULT_MODEL,
  MODEL_ARGUMENT,
  MODEL_OPTIONS,
  SERVICE_TIER_ARGUMENT,
  resolveServiceTier,
  type ServiceTier,
} from './options';
import { applyTheme, resolveScheme } from './theme';

const API_KEY_ARGUMENT = 'api_key';

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

export interface SettingsValues {
  apiKey: string;
  model: string;
  promptCacheMode: PromptCacheMode;
  serviceTier: ServiceTier;
}

export async function saveSettings(values: SettingsValues): Promise<void> {
  await Promise.all([
    saveApiKey(values.apiKey),
    saveModel(values.model),
    savePromptCacheMode(values.promptCacheMode),
    saveServiceTier(values.serviceTier),
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

interface SettingsFormElements {
  apiKeyInput: HTMLInputElement;
  modelSelect: HTMLSelectElement;
  promptCacheModeSelect: HTMLSelectElement;
  serviceTierSelect: HTMLSelectElement;
}

async function saveFromForm(
  elements: SettingsFormElements,
  button: HTMLButtonElement,
): Promise<void> {
  button.disabled = true;
  button.textContent = '저장 중...';

  try {
    await saveSettings({
      apiKey: elements.apiKeyInput.value,
      model: elements.modelSelect.value,
      promptCacheMode: resolvePromptCacheMode(elements.promptCacheModeSelect.value),
      serviceTier: resolveServiceTier(elements.serviceTierSelect.value) ?? 'default',
    });
    button.textContent = '저장됨';
  } catch (error) {
    button.textContent = '저장 실패';
    console.error('[llm-gateway-provider] Failed to save settings', error);
  } finally {
    button.disabled = false;
  }
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

function renderSettings(currentModel: string): void {
  if (!document.getElementById('llm-gateway-styles')) {
    const style = document.createElement('style');
    style.id = 'llm-gateway-styles';
    style.textContent = STYLES;
    document.head.appendChild(style);
  }

  document.body.innerHTML =
    '<main id="app">' +
      '<form id="settings-form">' +
        '<input id="api-key" type="password" aria-label="API key" placeholder="API key" autocomplete="off" spellcheck="false">' +
        '<select id="model" aria-label="모델">' +
          renderModelOptionsHtml(currentModel) +
        '</select>' +
        '<select id="prompt-cache-mode" aria-label="프롬프트 캐시 모드">' +
          '<option value="explicit">명시적 캐시 사용</option>' +
          '<option value="disabled">캐시 끄기</option>' +
        '</select>' +
        '<select id="service-tier" aria-label="서비스 티어">' +
          '<option value="default">스탠다드 티어</option>' +
          '<option value="flex">Flex 티어</option>' +
        '</select>' +
        '<div class="actions">' +
          '<button id="save" type="submit">저장</button>' +
          '<button id="close" type="button">닫기</button>' +
        '</div>' +
      '</form>' +
    '</main>';
}

export async function openSettings(): Promise<void> {
  await risuai.showContainer('fullscreen');

  const [apiKey, model, promptCacheMode, serviceTier] = await Promise.all([
    loadApiKey(),
    loadModel(),
    loadPromptCacheMode(),
    loadServiceTier(),
  ]);

  renderSettings(model);
  applyTheme(await resolveScheme());

  const elements: SettingsFormElements = {
    apiKeyInput: requireApiKeyInput(),
    modelSelect: requireSelect('model'),
    promptCacheModeSelect: requireSelect('prompt-cache-mode'),
    serviceTierSelect: requireSelect('service-tier'),
  };
  const saveButton = requireButton('save');
  const closeButton = requireButton('close');
  const form = requireSettingsForm();

  elements.apiKeyInput.value = apiKey;
  elements.modelSelect.value = model;
  elements.promptCacheModeSelect.value = promptCacheMode;
  elements.serviceTierSelect.value = serviceTier;
  elements.apiKeyInput.focus();

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void saveFromForm(elements, saveButton);
  });
  closeButton.addEventListener('click', () => {
    void risuai.hideContainer();
  });
}
