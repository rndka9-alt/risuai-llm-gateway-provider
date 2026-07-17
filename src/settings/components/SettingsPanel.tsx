import type { ComponentChildren } from 'preact';
import { resolvePromptCacheMode, type PromptCacheMode } from '../../cache';
import {
  REASONING_EFFORT_OPTIONS,
  VERBOSITY_OPTIONS,
  type ConfigurableLlmFlagName,
  type ReasoningEffort,
  type ServiceTier,
  type StreamingMode,
  type Verbosity,
} from '../../options';
import {
  FIELD_CAPTION_CLASS,
  FIELD_CLASS,
  SteppedSlider,
  type SteppedSliderOption,
} from './SteppedSlider';

const INPUT_CLASS =
  'h-[38px] w-full rounded-lg border border-ui-frame bg-ui-control px-3 text-[13px] text-ui-content outline-none focus:border-ui-accent focus:ring-2 focus:ring-ui-accent/30';
const NOTICE_CLASS = 'm-0 rounded-lg border border-ui-accent px-2.5 py-2 text-xs text-ui-content';
// 네이티브 select 화살표는 우측에 딱 붙어 여백을 줄 수 없어, CSS 그라디언트
// 셰브런 + pr-[34px]로 교체한다 (CSP상 외부/data 이미지 대신 그라디언트 사용).
const SELECT_CLASS = `${INPUT_CLASS} cursor-pointer appearance-none pr-[34px] bg-no-repeat [background-image:linear-gradient(45deg,transparent_50%,var(--text2)_50%),linear-gradient(135deg,var(--text2)_50%,transparent_50%)] [background-position:calc(100%_-_19px)_55%,calc(100%_-_14px)_55%] [background-size:5px_5px]`;

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

const REASONING_EFFORT_SLIDER_OPTIONS: readonly SteppedSliderOption<ReasoningEffort>[] = [
  { label: '지정 안 함', value: undefined },
  ...REASONING_EFFORT_OPTIONS.map((value) => ({ label: value, value })),
];

const VERBOSITY_SLIDER_OPTIONS: readonly SteppedSliderOption<Verbosity>[] = [
  { label: '지정 안 함', value: undefined },
  ...VERBOSITY_OPTIONS.map((value) => ({ label: value, value })),
];

export interface LedgerDisplay {
  amountText: string;
  tone: 'gain' | 'loss' | 'neutral';
}

const LEDGER_TONE_CLASSES: Record<LedgerDisplay['tone'], string> = {
  gain: 'text-ui-gain',
  loss: 'text-ui-loss',
  neutral: 'text-inherit',
};

interface HelpTooltipProps {
  children: ComponentChildren;
  id: string;
  label: string;
}

function HelpTooltip({ children, id, label }: HelpTooltipProps) {
  return (
    <span class="group relative inline-flex items-center">
      <button
        type="button"
        aria-label={label}
        aria-describedby={id}
        class="grid size-4 cursor-help place-items-center rounded-full border-0 bg-transparent p-0 text-[11px] leading-none text-ui-muted hover:text-ui-content focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ui-accent"
      >
        <span aria-hidden="true">ⓘ</span>
      </button>
      <span
        id={id}
        role="tooltip"
        class="pointer-events-none invisible absolute top-[calc(100%+7px)] left-[-4px] z-30 w-[min(250px,calc(100vw-64px))] -translate-y-1 rounded-lg border border-ui-on-popover/20 bg-ui-popover px-[11px] py-2.5 text-[11px] leading-[1.45] font-normal tracking-normal text-ui-on-popover opacity-0 shadow-xl transition duration-150 group-focus-within:pointer-events-auto group-focus-within:visible group-focus-within:translate-y-0 group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:visible group-hover:translate-y-0 group-hover:opacity-100"
      >
        {children}
      </span>
    </span>
  );
}

interface ToggleControlProps {
  ariaLabel: string;
  checked: boolean;
  id: string;
  label: string;
  onChange: (checked: boolean) => void;
}

function ToggleControl({ ariaLabel, checked, id, label, onChange }: ToggleControlProps) {
  return (
    <label
      htmlFor={id}
      class="flex h-[38px] w-full cursor-pointer items-center justify-between rounded-lg border border-ui-frame bg-ui-control px-3 text-[13px] text-ui-content"
    >
      <span id={`${id}-label`}>{label}</span>
      <span class="relative shrink-0">
        <input
          id={id}
          type="checkbox"
          role="switch"
          aria-label={ariaLabel}
          checked={checked}
          onChange={(event) => onChange(event.currentTarget.checked)}
          class="peer sr-only"
        />
        <span class="relative block h-5 w-[34px] rounded-full bg-ui-switch transition-colors peer-checked:bg-ui-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ui-accent after:absolute after:top-0.5 after:left-0.5 after:size-4 after:rounded-full after:bg-ui-knob after:shadow-sm after:transition-transform after:content-[''] peer-checked:after:translate-x-3.5 peer-checked:after:bg-ui-background" />
      </span>
    </label>
  );
}

interface ApiKeyFieldProps {
  apiKey: string;
  apiKeyVisible: boolean;
  onApiKeyChange: (apiKey: string) => void;
  onVisibilityToggle: () => void;
}

function ApiKeyField({
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

interface PromptCacheModeFieldProps {
  onChange: (promptCacheMode: PromptCacheMode) => void;
  promptCacheMode: PromptCacheMode;
}

function PromptCacheModeField({ onChange, promptCacheMode }: PromptCacheModeFieldProps) {
  return (
    <div class={FIELD_CLASS}>
      <span class="flex min-h-4 items-center gap-1">
        <label class={`${FIELD_CAPTION_CLASS} text-ui-accent`} htmlFor="prompt-cache-mode">
          캐시 모드
        </label>
        <HelpTooltip id="prompt-cache-mode-tooltip" label="캐시 모드 도움말">
          캐시 끄기 시에도 explicit 모드는 유지하고 breakpoint만 생략합니다. implicit 캐시로
          전환되지 않으며, 추가 캐시 쓰기 비용이 발생하지 않습니다.
        </HelpTooltip>
      </span>
      <select
        id="prompt-cache-mode"
        aria-label="프롬프트 캐시 모드"
        value={promptCacheMode}
        onChange={(event) => onChange(resolvePromptCacheMode(event.currentTarget.value))}
        class={`${SELECT_CLASS} border-ui-accent bg-ui-accent-soft font-semibold`}
      >
        <option value="explicit">명시적 캐시 사용</option>
        <option value="disabled">캐시 끄기</option>
      </select>
    </div>
  );
}

interface ModelFieldProps {
  model: string;
  modelOptions: readonly string[];
  onChange: (model: string) => void;
}

function ModelField({ model, modelOptions, onChange }: ModelFieldProps) {
  return (
    <div class={FIELD_CLASS}>
      <label class={FIELD_CAPTION_CLASS} htmlFor="model">
        모델
      </label>
      <select
        id="model"
        aria-label="모델"
        value={model}
        onChange={(event) => onChange(event.currentTarget.value)}
        class={SELECT_CLASS}
      >
        {modelOptions.map((modelOption) => (
          <option key={modelOption} value={modelOption}>
            {modelOption}
          </option>
        ))}
      </select>
    </div>
  );
}

function AdvancedDivider() {
  return (
    <div class="mt-0.5 flex items-center gap-2.5 text-[11px] text-ui-muted">
      <span class="w-2 border-t border-dashed border-ui-frame" />
      <span>고급</span>
      <span class="flex-1 border-t border-dashed border-ui-frame" />
    </div>
  );
}

interface StreamingModeFieldProps {
  onChange: (streamingMode: StreamingMode) => void;
  streamingMode: StreamingMode;
}

function StreamingModeField({ onChange, streamingMode }: StreamingModeFieldProps) {
  return (
    <div class={FIELD_CLASS}>
      <span class="flex min-h-4 items-center gap-1">
        <span class={FIELD_CAPTION_CLASS}>응답 방식</span>
        <HelpTooltip id="streaming-mode-tooltip" label="응답 방식 도움말">
          응답 데이터를 조각 단위로 실시간 수신합니다. 플러그인이 모두 조립한 뒤 RisuAI에 한 번에
          전달합니다.
        </HelpTooltip>
      </span>
      <ToggleControl
        id="streaming-mode"
        ariaLabel="응답 방식"
        checked={streamingMode === 'decoupled'}
        label={streamingMode === 'decoupled' ? '스트리밍 연결 · 완료 후 표시' : '일반 요청'}
        onChange={(checked) => onChange(checked ? 'decoupled' : 'off')}
      />
    </div>
  );
}

interface ServiceTierFieldProps {
  onChange: (serviceTier: ServiceTier | undefined) => void;
  serviceTier: ServiceTier | undefined;
}

function ServiceTierField({ onChange, serviceTier }: ServiceTierFieldProps) {
  return (
    <div class={FIELD_CLASS}>
      <span class="flex min-h-4 items-center gap-1">
        <span class={FIELD_CAPTION_CLASS}>서비스 티어</span>
        <HelpTooltip id="service-tier-tooltip" label="Flex 서비스 티어 도움말">
          입력·출력 비용이 절반으로 줄어듭니다. 대신 서버 상황에 따라 응답이 늦어지거나 실패할 수
          있습니다.
        </HelpTooltip>
      </span>
      <ToggleControl
        id="service-tier"
        ariaLabel="Flex 서비스 티어 사용"
        checked={serviceTier === 'flex'}
        label={serviceTier === 'flex' ? 'Flex' : 'Gateway 기본'}
        onChange={(checked) => onChange(checked ? 'flex' : undefined)}
      />
    </div>
  );
}

interface LlmFlagsFieldProps {
  flagNames: readonly ConfigurableLlmFlagName[];
  onChange: (flagName: ConfigurableLlmFlagName, checked: boolean) => void;
}

function LlmFlagsField({ flagNames, onChange }: LlmFlagsFieldProps) {
  return (
    <div class={FIELD_CLASS}>
      <span id="llm-flags-label" class={FIELD_CAPTION_CLASS}>
        LLM flags
      </span>
      <fieldset
        aria-labelledby="llm-flags-label"
        class="m-0 grid grid-cols-2 gap-x-2.5 gap-y-2 border-0 p-0"
      >
        {FLAG_OPTIONS.map((option) => (
          <label
            key={option.name}
            class="flex min-w-0 items-center gap-[7px] text-xs text-ui-content"
          >
            <input
              id={`flag-${option.name}`}
              type="checkbox"
              checked={flagNames.includes(option.name)}
              onChange={(event) => onChange(option.name, event.currentTarget.checked)}
              class="m-0 size-4 shrink-0 accent-ui-accent"
            />
            <span class="truncate">{option.label}</span>
          </label>
        ))}
        {/* convert.ts가 미디어를 보존할 때까지 대표 항목만 비활성 노출한다. */}
        <label class="flex min-w-0 items-center gap-[7px] text-xs text-ui-muted opacity-70">
          <input type="checkbox" disabled class="m-0 size-4 shrink-0" />
          <span class="truncate">Image Input · 미지원</span>
        </label>
      </fieldset>
    </div>
  );
}

interface SettingsNoticesProps {
  cacheBackoffActive: boolean;
  reloadNeeded: boolean;
  saveFailed: boolean;
}

function SettingsNotices({ cacheBackoffActive, reloadNeeded, saveFailed }: SettingsNoticesProps) {
  return (
    <>
      {reloadNeeded && (
        <p id="reload-notice" class={NOTICE_CLASS}>
          적용하려면 새로고침이 필요합니다.
        </p>
      )}
      {saveFailed && (
        <p id="save-error" class={NOTICE_CLASS}>
          저장에 실패했어요 — 콘솔을 확인해주세요.
        </p>
      )}
      {cacheBackoffActive && (
        <p id="cache-backoff-diagnostic" class="m-0 text-[0.8em] leading-[1.45] text-ui-muted">
          ⚠️ 프롬프트 앞부분이 매턴 바뀌어 캐시를 일시 중단했어요. 프리셋의
          {' {{time}}/{{random}}/확률 로어북을 확인해보세요'}
        </p>
      )}
    </>
  );
}

interface SettingsFooterProps {
  ledgerDisplay: LedgerDisplay;
  ledgerReadText: string;
  ledgerResetFailed: boolean;
  ledgerResetting: boolean;
  ledgerWriteText: string;
  onClose: () => void;
  onLedgerReset: () => void;
}

function SettingsFooter({
  ledgerDisplay,
  ledgerReadText,
  ledgerResetFailed,
  ledgerResetting,
  ledgerWriteText,
  onClose,
  onLedgerReset,
}: SettingsFooterProps) {
  return (
    <footer class="sticky bottom-0 z-10 flex min-h-14 items-center justify-between border-t border-ui-frame bg-ui-panel px-4 py-2.5">
      <div class="group relative flex min-w-0 items-center gap-0.5">
        <button
          id="ledger-summary"
          type="button"
          aria-label="캐시 손익 상세"
          aria-describedby="ledger-popover"
          class="flex min-w-0 cursor-help items-center gap-1.5 border-0 bg-transparent py-1 pr-0.5 pl-0 text-[11px] text-ui-muted hover:text-ui-content focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-accent"
        >
          <span
            id="ledger-amount-summary"
            class={`text-[12.5px] font-semibold tabular-nums ${LEDGER_TONE_CLASSES[ledgerDisplay.tone]}`}
          >
            {ledgerDisplay.amountText}
          </span>
          <span class="text-[11px]" aria-hidden="true">
            ⓘ
          </span>
        </button>
        <button
          id="ledger-reset"
          type="button"
          disabled={ledgerResetting}
          aria-label="캐시 손익 초기화"
          title="캐시 손익 초기화"
          onClick={onLedgerReset}
          class="grid size-[22px] cursor-pointer place-items-center rounded-[5px] border-0 bg-transparent p-0 text-[15px] leading-none text-ui-muted hover:bg-ui-content/10 hover:text-ui-content focus-visible:outline-2 focus-visible:outline-ui-accent disabled:cursor-wait disabled:opacity-70"
        >
          ×
        </button>
        <div
          id="ledger-popover"
          role="tooltip"
          class="pointer-events-none invisible absolute bottom-[calc(100%+11px)] left-[-2px] z-20 w-[190px] translate-y-1 rounded-lg border border-ui-on-popover/20 bg-ui-popover px-3 py-[11px] text-ui-on-popover opacity-0 shadow-xl transition duration-150 group-focus-within:pointer-events-auto group-focus-within:visible group-focus-within:translate-y-0 group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:visible group-hover:translate-y-0 group-hover:opacity-100"
        >
          <div class="flex flex-col gap-1.5">
            <div class="flex justify-between gap-3 text-[11px] tabular-nums">
              <span>읽기</span>
              <span id="ledger-read-detail">{ledgerReadText}</span>
            </div>
            <div class="flex justify-between gap-3 text-[11px] tabular-nums">
              <span>쓰기</span>
              <span id="ledger-write-detail">{ledgerWriteText}</span>
            </div>
            <div class="flex justify-between gap-3 border-t border-ui-on-popover/25 pt-1 text-[11px] tabular-nums">
              <span>캐시 손익</span>
              <span
                id="ledger-amount"
                class={ledgerResetFailed ? 'text-ui-loss' : LEDGER_TONE_CLASSES[ledgerDisplay.tone]}
              >
                {ledgerResetFailed ? '초기화 실패' : ledgerDisplay.amountText}
              </span>
            </div>
          </div>
        </div>
      </div>
      <button
        id="close"
        type="button"
        onClick={onClose}
        class="min-w-[58px] cursor-pointer rounded-[9px] border border-ui-content/70 bg-ui-contrast px-3.5 py-2 text-xs font-semibold text-ui-background hover:bg-ui-contrast-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-accent"
      >
        닫기
      </button>
    </footer>
  );
}

interface SettingsPanelProps {
  apiKey: string;
  apiKeyVisible: boolean;
  cacheBackoffActive: boolean;
  flagNames: readonly ConfigurableLlmFlagName[];
  ledgerDisplay: LedgerDisplay;
  ledgerReadText: string;
  ledgerResetFailed: boolean;
  ledgerResetting: boolean;
  ledgerWriteText: string;
  model: string;
  modelOptions: readonly string[];
  onApiKeyChange: (apiKey: string) => void;
  onApiKeyVisibilityToggle: () => void;
  onClose: () => void;
  onFlagChange: (flagName: ConfigurableLlmFlagName, checked: boolean) => void;
  onLedgerReset: () => void;
  onModelChange: (model: string) => void;
  onPromptCacheModeChange: (promptCacheMode: PromptCacheMode) => void;
  onReasoningEffortChange: (reasoningEffort: ReasoningEffort | undefined) => void;
  onServiceTierChange: (serviceTier: ServiceTier | undefined) => void;
  onStreamingModeChange: (streamingMode: StreamingMode) => void;
  onVerbosityChange: (verbosity: Verbosity | undefined) => void;
  promptCacheMode: PromptCacheMode;
  reasoningEffort: ReasoningEffort | undefined;
  reloadNeeded: boolean;
  saveFailed: boolean;
  serviceTier: ServiceTier | undefined;
  streamingMode: StreamingMode;
  verbosity: Verbosity | undefined;
}

export function SettingsPanel({
  apiKey,
  apiKeyVisible,
  cacheBackoffActive,
  flagNames,
  ledgerDisplay,
  ledgerReadText,
  ledgerResetFailed,
  ledgerResetting,
  ledgerWriteText,
  model,
  modelOptions,
  onApiKeyChange,
  onApiKeyVisibilityToggle,
  onClose,
  onFlagChange,
  onLedgerReset,
  onModelChange,
  onPromptCacheModeChange,
  onReasoningEffortChange,
  onServiceTierChange,
  onStreamingModeChange,
  onVerbosityChange,
  promptCacheMode,
  reasoningEffort,
  reloadNeeded,
  saveFailed,
  serviceTier,
  streamingMode,
  verbosity,
}: SettingsPanelProps) {
  return (
    <main
      id="app"
      class="max-h-[calc(100vh-40px)] w-full max-w-96 overflow-auto rounded-[14px] border border-ui-frame bg-ui-panel shadow-2xl max-[420px]:max-h-[calc(100vh-20px)]"
    >
      <form id="settings-form" class="flex flex-col" onSubmit={(event) => event.preventDefault()}>
        <div class="flex flex-col gap-3 px-[18px] pt-5 pb-[18px] max-[420px]:px-4">
          <ApiKeyField
            apiKey={apiKey}
            apiKeyVisible={apiKeyVisible}
            onApiKeyChange={onApiKeyChange}
            onVisibilityToggle={onApiKeyVisibilityToggle}
          />

          <PromptCacheModeField
            promptCacheMode={promptCacheMode}
            onChange={onPromptCacheModeChange}
          />

          <SteppedSlider
            id="reasoning-effort"
            ariaLabel="Reasoning effort"
            label="Reasoning effort"
            value={reasoningEffort}
            options={REASONING_EFFORT_SLIDER_OPTIONS}
            onInput={onReasoningEffortChange}
          />

          <SteppedSlider
            id="verbosity"
            ariaLabel="Verbosity"
            label="Verbosity"
            value={verbosity}
            options={VERBOSITY_SLIDER_OPTIONS}
            onInput={onVerbosityChange}
          />

          <ModelField model={model} modelOptions={modelOptions} onChange={onModelChange} />

          <AdvancedDivider />

          <StreamingModeField streamingMode={streamingMode} onChange={onStreamingModeChange} />

          <ServiceTierField serviceTier={serviceTier} onChange={onServiceTierChange} />

          <LlmFlagsField flagNames={flagNames} onChange={onFlagChange} />

          <SettingsNotices
            cacheBackoffActive={cacheBackoffActive}
            reloadNeeded={reloadNeeded}
            saveFailed={saveFailed}
          />
        </div>

        <SettingsFooter
          ledgerDisplay={ledgerDisplay}
          ledgerReadText={ledgerReadText}
          ledgerResetFailed={ledgerResetFailed}
          ledgerResetting={ledgerResetting}
          ledgerWriteText={ledgerWriteText}
          onClose={onClose}
          onLedgerReset={onLedgerReset}
        />
      </form>
    </main>
  );
}
