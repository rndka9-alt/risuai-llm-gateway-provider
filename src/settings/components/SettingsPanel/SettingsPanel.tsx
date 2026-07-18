import type { PromptCacheMode } from '../../../cache';
import {
  REASONING_EFFORT_OPTIONS,
  VERBOSITY_OPTIONS,
  type ConfigurableLlmFlagName,
  type ReasoningEffort,
  type ServiceTier,
  type StreamingMode,
  type Verbosity,
} from '../../../options';
import { SettingsFooter, type LedgerDisplay } from './components/SettingsFooter';
import { SettingsNotices } from './components/SettingsNotices';
import { SteppedSlider, type SteppedSliderOption } from '../SteppedSlider';
import { ApiKeyField } from './components/ApiKeyField';
import { LlmFlagsField } from './components/LlmFlagsField';
import { ModelField } from './components/ModelField';
import { PromptCacheModeField } from './components/PromptCacheModeField';
import { ServiceTierField } from './components/ServiceTierField';
import { StreamingModeField } from './components/StreamingModeField';

const REASONING_EFFORT_SLIDER_OPTIONS: readonly SteppedSliderOption<ReasoningEffort>[] = [
  { label: '지정 안 함', value: undefined },
  ...REASONING_EFFORT_OPTIONS.map((value) => ({ label: value, value })),
];

const VERBOSITY_SLIDER_OPTIONS: readonly SteppedSliderOption<Verbosity>[] = [
  { label: '지정 안 함', value: undefined },
  ...VERBOSITY_OPTIONS.map((value) => ({ label: value, value })),
];

function AdvancedDivider() {
  return (
    <div class="mt-0.5 flex items-center gap-2.5 text-[11px] text-ui-muted">
      <span class="w-2 border-t border-dashed border-ui-frame" />
      <span>고급</span>
      <span class="flex-1 border-t border-dashed border-ui-frame" />
    </div>
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
