import { SettingsFooter } from './components/SettingsFooter';
import { SettingsNotices } from './components/SettingsNotices';
import { ApiKeyField } from './components/ApiKeyField';
import { LlmFlagsField } from './components/LlmFlagsField';
import { ModelField } from './components/ModelField';
import { PromptCacheModeField } from './components/PromptCacheModeField';
import { ReasoningEffortField } from './components/ReasoningEffortField';
import { RequestBodyField } from './components/RequestBodyField/RequestBodyField';
import { ServiceTierField } from './components/ServiceTierField';
import { StreamingModeField } from './components/StreamingModeField';
import { VerbosityField } from './components/VerbosityField';

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
  cacheBackoffActive: boolean;
}

export function SettingsPanel({ cacheBackoffActive }: SettingsPanelProps) {
  return (
    <main
      id="app"
      class="max-h-[calc(100vh-40px)] w-full max-w-96 overflow-auto rounded-[14px] border border-ui-frame bg-ui-panel shadow-2xl max-[420px]:max-h-[calc(100vh-20px)]"
    >
      <form id="settings-form" class="flex flex-col" onSubmit={(event) => event.preventDefault()}>
        <div class="flex flex-col gap-3 px-[18px] pt-5 pb-[18px] max-[420px]:px-4">
          <ApiKeyField />

          <PromptCacheModeField />

          <ReasoningEffortField />

          <VerbosityField />

          <ModelField />

          <AdvancedDivider />

          <StreamingModeField />

          <ServiceTierField />

          <LlmFlagsField />

          <RequestBodyField />

          <SettingsNotices cacheBackoffActive={cacheBackoffActive} />
        </div>

        <SettingsFooter />
      </form>
    </main>
  );
}
