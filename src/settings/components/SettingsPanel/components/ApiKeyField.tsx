import { useEffect, useRef, useState } from 'preact/hooks';
import { FIELD_CAPTION_CLASS, FIELD_CLASS, INPUT_CLASS } from '../../constants';
import { persistSetting } from '../../../utils/persistence';
import { updateSettingsSnapshot, useSettingsSnapshot } from '../../../utils/settings-snapshot';
import { saveApiKey } from '../../../utils/storage';

interface ApiKeyFieldProps {
  editing: boolean;
  onCommit: (configured: boolean) => void;
}

export function ApiKeyField({ editing, onCommit }: ApiKeyFieldProps) {
  const { apiKey } = useSettingsSnapshot();
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && apiKey.trim() !== '') inputRef.current?.focus();
  }, [editing]);

  const commitApiKey = (): void => {
    const input = inputRef.current;
    if (input === null) throw new Error('API key input unavailable while committing');
    persistSetting(() => saveApiKey(input.value));
    onCommit(input.value.trim() !== '');
  };

  return (
    <div
      id="api-key-editor"
      aria-hidden={!editing}
      onFocusOut={(event) => {
        const nextTarget = event.relatedTarget;
        if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
        commitApiKey();
      }}
      class={`absolute inset-y-0 left-0 z-10 flex min-w-0 items-center gap-2 overflow-hidden bg-ui-panel transition-[width,opacity] duration-150 ease-out motion-reduce:transition-none ${editing ? 'w-full opacity-100' : 'pointer-events-none w-0 opacity-0'}`}
    >
      <label class={`${FIELD_CAPTION_CLASS} shrink-0 whitespace-nowrap`} htmlFor="api-key">
        API 키
      </label>
      <div class={`${FIELD_CLASS} relative min-w-[180px] flex-1`}>
        <input
          id="api-key"
          ref={inputRef}
          type={apiKeyVisible ? 'text' : 'password'}
          aria-label="API key"
          autocomplete="off"
          disabled={!editing}
          spellcheck={false}
          value={apiKey}
          onInput={(event) => {
            const nextApiKey = event.currentTarget.value;
            updateSettingsSnapshot({ apiKey: nextApiKey });
          }}
          class={`${INPUT_CLASS} pr-[46px] tracking-[0.08em]`}
        />
        <button
          id="api-key-visibility"
          type="button"
          aria-label={apiKeyVisible ? 'API 키 숨기기' : 'API 키 표시'}
          aria-pressed={apiKeyVisible}
          disabled={!editing}
          onClick={() => setApiKeyVisible((visible) => !visible)}
          class="absolute top-[7px] right-[7px] grid h-6 w-[30px] cursor-pointer place-items-center border-0 border-l border-ui-frame bg-transparent p-0 text-ui-muted focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ui-accent"
        >
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            class="size-4 fill-none stroke-current stroke-[1.6] [stroke-linecap:round] [stroke-linejoin:round]"
          >
            <path d="M2.5 12c2.1-3.8 5.2-6 9.5-6s7.4 2.2 9.5 6c-2.1 3.8-5.2 6-9.5 6S4.6 15.8 2.5 12Z" />
            <circle cx="12" cy="12" r="2.75" />
            {apiKeyVisible && <path d="m4 4 16 16" />}
          </svg>
        </button>
      </div>
    </div>
  );
}
