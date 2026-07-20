import { SettingsFooter } from './components/SettingsFooter';
import { SettingsNotices } from './components/SettingsNotices';
import { AdvancedSettingsAccordion } from './components/AdvancedSettingsAccordion';
import { PromptCacheModeField } from './components/PromptCacheModeField';
import { ReasoningEffortField } from './components/ReasoningEffortField';
import { RequestBodyAccordion } from './components/RequestBodyAccordion';
import { SettingsStatusBar } from './components/SettingsStatusBar';
import { VerbosityField } from './components/VerbosityField';

interface SettingsPanelProps {
  cacheBackoffActive: boolean;
}

export function SettingsPanel({ cacheBackoffActive }: SettingsPanelProps) {
  // 접힌 기본 상태는 컴팩트(min 420px)하게, 아코디언이 펼쳐지면 내용을 따라
  // min(720px, 100vh-40px)까지 자라고 그 이상은 내부 스크롤로 처리한다.
  return (
    <main
      id="app"
      class="flex max-h-[min(720px,calc(100vh-40px))] min-h-[420px] w-full max-w-96 flex-col overflow-hidden rounded-[14px] border border-ui-frame bg-ui-panel shadow-2xl max-[420px]:max-h-[calc(100vh-20px)]"
    >
      <form
        id="settings-form"
        class="flex min-h-0 flex-1 flex-col"
        onSubmit={(event) => event.preventDefault()}
      >
        <div class="settings-scroll flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-[18px] pb-[18px] max-[420px]:px-4">
          <SettingsStatusBar />

          <PromptCacheModeField />

          <ReasoningEffortField />

          <VerbosityField />

          <RequestBodyAccordion />

          <AdvancedSettingsAccordion />

          <SettingsNotices cacheBackoffActive={cacheBackoffActive} />
        </div>

        <SettingsFooter />
      </form>
    </main>
  );
}
