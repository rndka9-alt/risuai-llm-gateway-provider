import { FIELD_CAPTION_CLASS, FIELD_CLASS, INPUT_CLASS } from '../../constants';

interface ApiKeyFieldProps {
  apiKey: string;
  apiKeyVisible: boolean;
  onApiKeyChange: (apiKey: string) => void;
  onVisibilityToggle: () => void;
}

export function ApiKeyField({
  apiKey,
  apiKeyVisible,
  onApiKeyChange,
  onVisibilityToggle,
}: ApiKeyFieldProps) {
  return (
    <div class={FIELD_CLASS}>
      <label class={FIELD_CAPTION_CLASS} htmlFor="api-key">
        API 키
      </label>
      <div class="relative">
        <input
          id="api-key"
          type={apiKeyVisible ? 'text' : 'password'}
          aria-label="API key"
          autocomplete="off"
          spellcheck={false}
          value={apiKey}
          onChange={(event) => onApiKeyChange(event.currentTarget.value)}
          class={`${INPUT_CLASS} pr-[46px] tracking-[0.08em]`}
        />
        <button
          id="api-key-visibility"
          type="button"
          aria-label={apiKeyVisible ? 'API 키 숨기기' : 'API 키 표시'}
          aria-pressed={apiKeyVisible}
          onClick={onVisibilityToggle}
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
