import { Eye, EyeOff } from 'lucide-preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
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
  const togglingVisibilityRef = useRef(false);

  useEffect(() => {
    if (editing && apiKey.trim() !== '') inputRef.current?.focus();
  }, [editing]);

  useLayoutEffect(() => {
    if (!editing || !togglingVisibilityRef.current) return;
    inputRef.current?.focus();
    togglingVisibilityRef.current = false;
  }, [apiKeyVisible, editing]);

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
        // iOS Safari는 password/text 전환 중 relatedTarget 없이 input을 blur할 수 있다.
        // 눈 버튼에서 시작한 포인터 상호작용은 editor 바깥 이탈이 아니므로 접지 않는다.
        if (togglingVisibilityRef.current) return;
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
          aria-label="API 키"
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
          onPointerDown={(event) => {
            togglingVisibilityRef.current = true;
            event.preventDefault();
          }}
          onPointerUp={() => {
            window.setTimeout(() => {
              togglingVisibilityRef.current = false;
            }, 0);
          }}
          onPointerCancel={() => {
            togglingVisibilityRef.current = false;
          }}
          onClick={() => setApiKeyVisible((visible) => !visible)}
          class="absolute top-[7px] right-[7px] grid h-6 w-[30px] cursor-pointer place-items-center border-0 border-l border-ui-frame bg-transparent p-0 text-ui-muted focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ui-accent"
        >
          {apiKeyVisible ? (
            <EyeOff size={16} strokeWidth={1.6} aria-hidden="true" />
          ) : (
            <Eye size={16} strokeWidth={1.6} aria-hidden="true" />
          )}
        </button>
      </div>
    </div>
  );
}
