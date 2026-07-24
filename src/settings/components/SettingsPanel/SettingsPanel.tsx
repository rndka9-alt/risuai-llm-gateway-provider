import { TriangleAlert } from 'lucide-preact';
import { SettingsFooter } from './components/SettingsFooter';
import { SettingsNotices } from './components/SettingsNotices';
import { AdvancedSettingsAccordion } from './components/AdvancedSettingsAccordion';
import { PromptCacheModeField } from './components/PromptCacheModeField';
import { ReasoningEffortField } from './components/ReasoningEffortField';
import { RequestBodyAccordion } from './components/RequestBodyAccordion';
import { SettingsStatusBar } from './components/SettingsStatusBar';
import { VerbosityField } from './components/VerbosityField';
import { useFooterMessage } from '../../utils/footer-messages';
import { useSettingsSignals } from '../../utils/signals';

interface SettingsPanelProps {
  cacheBackoffActive: boolean;
}

// useFooterMessage는 content 참조가 바뀌면 재발행하므로 모듈 상수로 고정한다
const CACHE_BACKOFF_FOOTER_MESSAGE = (
  <span class="flex items-start gap-1.5">
    <TriangleAlert
      size={14}
      strokeWidth={1.7}
      aria-hidden="true"
      class="mt-px shrink-0 text-ui-warn"
    />
    <span>프롬프트 앞부분이 계속 바뀌어 캐싱을 잠시 멈췄어요.</span>
  </span>
);

export function SettingsPanel({ cacheBackoffActive }: SettingsPanelProps) {
  const { reloadNeeded } = useSettingsSignals();
  // 스크롤 하단 notices에선 못 보고 지나치는 안내라 항상 보이는 푸터로 발행한다.
  // 새로고침(사용자 액션 필요)이 백오프(정보성)보다 먼저 보이게 우선순위를 둔다.
  useFooterMessage(reloadNeeded ? '변경 사항을 적용하려면 새로고침해 주세요.' : null, 1);
  useFooterMessage(cacheBackoffActive ? CACHE_BACKOFF_FOOTER_MESSAGE : null);

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

          <SettingsNotices />
        </div>

        <SettingsFooter />
      </form>
    </main>
  );
}
