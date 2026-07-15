import { STYLES } from './constants';
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

function requireApiKeyInput(): HTMLInputElement {
  const element = document.getElementById('api-key');
  if (!(element instanceof HTMLInputElement)) {
    throw new Error('API key input was not rendered');
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

async function saveFromForm(input: HTMLInputElement, button: HTMLButtonElement): Promise<void> {
  button.disabled = true;
  button.textContent = '저장 중...';

  try {
    await saveApiKey(input.value);
    button.textContent = '저장됨';
  } catch (error) {
    button.textContent = '저장 실패';
    console.error('[llm-gateway-provider] Failed to save API key', error);
  } finally {
    button.disabled = false;
  }
}

function renderSettings(): void {
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
        '<div class="actions">' +
          '<button id="save" type="submit">저장</button>' +
          '<button id="close" type="button">닫기</button>' +
        '</div>' +
      '</form>' +
    '</main>';
}

export async function openSettings(): Promise<void> {
  await risuai.showContainer('fullscreen');
  renderSettings();
  applyTheme(await resolveScheme());

  const input = requireApiKeyInput();
  const saveButton = requireButton('save');
  const closeButton = requireButton('close');
  const form = requireSettingsForm();

  input.value = await loadApiKey();
  input.focus();

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void saveFromForm(input, saveButton);
  });
  closeButton.addEventListener('click', () => {
    void risuai.hideContainer();
  });
}
