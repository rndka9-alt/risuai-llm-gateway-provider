import { render, type ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
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
} from './config';
import {
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
  MODEL_OPTIONS,
  REASONING_EFFORT_OPTIONS,
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

const SETTINGS_STYLE_ID = 'llm-gateway-styles';
const SETTINGS_BODY_CLASS =
  'm-0 flex min-h-screen items-center justify-center bg-black/55 p-5 font-sans text-ui-content max-[420px]:p-2.5';
const FIELD_CLASS = 'flex min-w-0 flex-col gap-1.5';
const FIELD_CAPTION_CLASS =
  'text-[11px] font-medium leading-tight tracking-[0.01em] text-ui-muted';
const INPUT_CLASS =
  'h-[38px] w-full rounded-lg border border-ui-frame bg-ui-control px-3 text-[13px] text-ui-content outline-none focus:border-ui-accent focus:ring-2 focus:ring-ui-accent/30';
const NOTICE_CLASS =
  'm-0 rounded-lg border border-ui-accent px-2.5 py-2 text-xs text-ui-content';
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

const LEDGER_TONE_CLASSES: Record<LedgerDisplay['tone'], string> = {
  gain: 'text-ui-gain',
  loss: 'text-ui-loss',
  neutral: 'text-inherit',
};

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

export async function saveReasoningEffort(
  value: ReasoningEffort | undefined,
): Promise<void> {
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

export async function loadConfigurableLlmFlagNames(): Promise<
  readonly ConfigurableLlmFlagName[]
> {
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
  return MODEL_OPTIONS.includes(currentModel)
    ? MODEL_OPTIONS
    : [currentModel, ...MODEL_OPTIONS];
}

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
        class="pointer-events-none invisible absolute top-[calc(100%+7px)] left-[-4px] z-30 w-[min(250px,calc(100vw-64px))] -translate-y-1 rounded-lg border border-ui-on-popover/20 bg-ui-popover px-[11px] py-2.5 text-[11px] leading-[1.45] font-normal tracking-normal text-ui-on-popover opacity-0 shadow-xl transition duration-150 group-hover:pointer-events-auto group-hover:visible group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:visible group-focus-within:translate-y-0 group-focus-within:opacity-100"
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
      class="flex h-[38px] w-full cursor-pointer items-center justify-between rounded-lg border border-ui-frame bg-ui-control px-3 text-[13px] text-ui-muted"
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
        <span class="relative block h-5 w-[34px] rounded-full bg-ui-switch transition-colors after:absolute after:top-0.5 after:left-0.5 after:size-4 after:rounded-full after:bg-ui-knob after:shadow-sm after:transition-transform after:content-[''] peer-checked:bg-ui-accent peer-checked:after:translate-x-3.5 peer-checked:after:bg-ui-background peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ui-accent" />
      </span>
    </label>
  );
}

interface SettingsAppProps extends SettingsValues {
  cacheBackoffActive: boolean;
  cacheLedger: CacheLedger;
  registrationSignature: string;
}

export function SettingsApp(initialValues: SettingsAppProps) {
  const [apiKey, setApiKey] = useState(initialValues.apiKey);
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
  const [model, setModel] = useState(initialValues.model);
  const [promptCacheMode, setPromptCacheMode] = useState(
    initialValues.promptCacheMode,
  );
  const [serviceTier, setServiceTier] = useState(initialValues.serviceTier);
  const [reasoningEffort, setReasoningEffort] = useState(
    initialValues.reasoningEffort,
  );
  const [verbosity, setVerbosity] = useState(initialValues.verbosity);
  const [streamingMode, setStreamingMode] = useState(initialValues.streamingMode);
  const [flagNames, setFlagNames] = useState(initialValues.flagNames);
  const [reloadNeeded, setReloadNeeded] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [cacheLedger, setCacheLedger] = useState(initialValues.cacheLedger);
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
      setCacheLedger(await loadCacheLedger());
    } catch (error) {
      setLedgerResetFailed(true);
      console.error('[llm-gateway-provider] Failed to reset cache ledger', error);
    } finally {
      setLedgerResetting(false);
    }
  };

  return (
    <main
      id="app"
      class="max-h-[calc(100vh-40px)] w-full max-w-96 overflow-auto rounded-[14px] border border-ui-frame bg-ui-panel shadow-2xl max-[420px]:max-h-[calc(100vh-20px)]"
    >
      <form
        id="settings-form"
        class="flex flex-col"
        onSubmit={(event) => event.preventDefault()}
      >
        <div class="flex flex-col gap-3 px-[18px] pt-5 pb-[18px] max-[420px]:px-4">
          <div class={FIELD_CLASS}>
            <label class={FIELD_CAPTION_CLASS} htmlFor="api-key">API 키</label>
            <div class="relative">
              <input
                id="api-key"
                type={apiKeyVisible ? 'text' : 'password'}
                aria-label="API key"
                autocomplete="off"
                spellcheck={false}
                value={apiKey}
                onChange={(event) => {
                  const nextApiKey = event.currentTarget.value;
                  setApiKey(nextApiKey);
                  persist(() => saveApiKey(nextApiKey));
                }}
                class={`${INPUT_CLASS} pr-[46px] tracking-[0.08em]`}
              />
              <button
                id="api-key-visibility"
                type="button"
                aria-label={apiKeyVisible ? 'API 키 숨기기' : 'API 키 표시'}
                aria-pressed={apiKeyVisible}
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

          <div class={FIELD_CLASS}>
            <label class={`${FIELD_CAPTION_CLASS} text-ui-accent`} htmlFor="prompt-cache-mode">
              캐시 모드
            </label>
            <select
              id="prompt-cache-mode"
              aria-label="프롬프트 캐시 모드"
              value={promptCacheMode}
              onChange={(event) => {
                const nextMode = resolvePromptCacheMode(event.currentTarget.value);
                setPromptCacheMode(nextMode);
                persist(() => savePromptCacheMode(nextMode));
              }}
              class={`${SELECT_CLASS} border-ui-accent bg-ui-accent-soft font-semibold`}
            >
              <option value="explicit">명시적 캐시 사용</option>
              <option value="disabled">캐시 끄기</option>
            </select>
          </div>

          <div class={FIELD_CLASS}>
            <label class={FIELD_CAPTION_CLASS} htmlFor="reasoning-effort">
              Reasoning effort
            </label>
            <select
              id="reasoning-effort"
              aria-label="Reasoning effort"
              value={reasoningEffort ?? ''}
              onChange={(event) => {
                const nextEffort = resolveReasoningEffort(event.currentTarget.value);
                setReasoningEffort(nextEffort);
                persist(() => saveReasoningEffort(nextEffort));
              }}
              class={SELECT_CLASS}
            >
              <option value="">지정 안 함</option>
              {REASONING_EFFORT_OPTIONS.map((effort) => (
                <option key={effort} value={effort}>{effort}</option>
              ))}
            </select>
          </div>

          <div class={FIELD_CLASS}>
            <label class={FIELD_CAPTION_CLASS} htmlFor="verbosity">Verbosity</label>
            <select
              id="verbosity"
              aria-label="Verbosity"
              value={verbosity ?? ''}
              onChange={(event) => {
                const nextVerbosity = resolveVerbosity(event.currentTarget.value);
                setVerbosity(nextVerbosity);
                persist(() => saveVerbosity(nextVerbosity));
              }}
              class={SELECT_CLASS}
            >
              <option value="">지정 안 함</option>
              {VERBOSITY_OPTIONS.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>

          <div class={FIELD_CLASS}>
            <span class="flex min-h-4 items-center gap-1">
              <span class={FIELD_CAPTION_CLASS}>응답 방식</span>
              <HelpTooltip id="streaming-mode-tooltip" label="응답 방식 도움말">
                응답 데이터를 조각 단위로 실시간 수신합니다. 플러그인이 모두 조립한 뒤
                RisuAI에 한 번에 전달합니다.
              </HelpTooltip>
            </span>
            <ToggleControl
              id="streaming-mode"
              ariaLabel="응답 방식"
              checked={streamingMode === 'decoupled'}
              label={
                streamingMode === 'decoupled'
                  ? '스트리밍 연결 · 완료 후 표시'
                  : '일반 요청'
              }
              onChange={(checked) => {
                const nextMode: StreamingMode = checked ? 'decoupled' : 'off';
                setStreamingMode(nextMode);
                persist(() => saveStreamingMode(nextMode));
              }}
            />
          </div>

          <div class="mt-0.5 flex items-center gap-2.5 text-[11px] text-ui-muted">
            <span class="w-2 border-t border-dashed border-ui-frame" />
            <span>고급</span>
            <span class="flex-1 border-t border-dashed border-ui-frame" />
          </div>

          <div class={FIELD_CLASS}>
            <label class={FIELD_CAPTION_CLASS} htmlFor="model">모델</label>
            <select
              id="model"
              aria-label="모델"
              value={model}
              onChange={(event) => {
                const nextModel = event.currentTarget.value;
                setModel(nextModel);
                persist(() => saveModel(nextModel));
              }}
              class={SELECT_CLASS}
            >
              {buildModelOptionList(model).map((modelOption) => (
                <option key={modelOption} value={modelOption}>{modelOption}</option>
              ))}
            </select>
          </div>

          <div class={FIELD_CLASS}>
            <span class="flex min-h-4 items-center gap-1">
              <span class={FIELD_CAPTION_CLASS}>서비스 티어</span>
              <HelpTooltip id="service-tier-tooltip" label="Flex 서비스 티어 도움말">
                입력·출력 비용이 절반으로 줄어듭니다. 대신 서버 상황에 따라 응답이
                늦어지거나 실패할 수 있습니다.
              </HelpTooltip>
            </span>
            <ToggleControl
              id="service-tier"
              ariaLabel="Flex 서비스 티어 사용"
              checked={serviceTier === 'flex'}
              label={serviceTier === 'flex' ? 'Flex' : 'Gateway 기본'}
              onChange={(checked) => {
                const nextTier: ServiceTier | undefined = checked ? 'flex' : undefined;
                setServiceTier(nextTier);
                persist(() => saveServiceTier(nextTier));
              }}
            />
          </div>

          <div class={FIELD_CLASS}>
            <span id="llm-flags-label" class={FIELD_CAPTION_CLASS}>LLM flags</span>
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
                    onChange={(event) =>
                      updateFlag(option.name, event.currentTarget.checked)}
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
          {initialValues.cacheBackoffActive && (
            <p id="cache-backoff-diagnostic" class="m-0 text-[0.8em] leading-[1.45] text-ui-muted">
              ⚠️ 프롬프트 앞부분이 매턴 바뀌어 캐시를 일시 중단했어요. 프리셋의
              {' {{time}}/{{random}}/확률 로어북을 확인해보세요'}
            </p>
          )}
        </div>

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
              <span class="text-[11px]" aria-hidden="true">ⓘ</span>
            </button>
            <button
              id="ledger-reset"
              type="button"
              disabled={ledgerResetting}
              aria-label="캐시 손익 초기화"
              title="캐시 손익 초기화"
              onClick={() => void resetLedger()}
              class="grid size-[22px] cursor-pointer place-items-center rounded-[5px] border-0 bg-transparent p-0 text-[15px] leading-none text-ui-muted hover:bg-ui-content/10 hover:text-ui-content focus-visible:outline-2 focus-visible:outline-ui-accent disabled:cursor-wait disabled:opacity-70"
            >
              ×
            </button>
            <div
              id="ledger-popover"
              role="tooltip"
              class="pointer-events-none invisible absolute bottom-[calc(100%+11px)] left-[-2px] z-20 w-[190px] translate-y-1 rounded-lg border border-ui-on-popover/20 bg-ui-popover px-3 py-[11px] text-ui-on-popover opacity-0 shadow-xl transition duration-150 group-hover:pointer-events-auto group-hover:visible group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:visible group-focus-within:translate-y-0 group-focus-within:opacity-100"
            >
              <div class="flex flex-col gap-1.5">
                <div class="flex justify-between gap-3 text-[11px] tabular-nums">
                  <span>읽기</span>
                  <span id="ledger-read-detail">{formatTokenCount(cacheLedger.readTokens)}</span>
                </div>
                <div class="flex justify-between gap-3 text-[11px] tabular-nums">
                  <span>쓰기</span>
                  <span id="ledger-write-detail">{formatTokenCount(cacheLedger.writeTokens)}</span>
                </div>
                <div class="flex justify-between gap-3 border-t border-ui-on-popover/25 pt-1 text-[11px] tabular-nums">
                  <span>캐시 손익</span>
                  <span
                    id="ledger-amount"
                    class={
                      ledgerResetFailed
                        ? 'text-ui-loss'
                        : LEDGER_TONE_CLASSES[ledgerDisplay.tone]
                    }
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
            onClick={() => void risuai.hideContainer()}
            class="min-w-[58px] cursor-pointer rounded-[9px] border border-ui-content/70 bg-ui-contrast px-3.5 py-2 text-xs font-semibold text-ui-background hover:bg-ui-contrast-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-accent"
          >
            닫기
          </button>
        </footer>
      </form>
    </main>
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

  renderSettings({
    apiKey,
    cacheBackoffActive: isCacheBackoffActive(cacheAnchorState),
    cacheLedger,
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
