import { TriangleAlert } from 'lucide-preact';
import { NOTICE_CLASS } from '../../constants';
import { useSettingsSignals } from '../../../utils/signals';

interface SettingsNoticesProps {
  cacheBackoffActive: boolean;
}

export function SettingsNotices({ cacheBackoffActive }: SettingsNoticesProps) {
  const { reloadNeeded, saveFailed } = useSettingsSignals();

  return (
    <>
      {reloadNeeded && (
        <p id="reload-notice" class={NOTICE_CLASS}>
          변경 사항을 적용하려면 새로고침해 주세요.
        </p>
      )}
      {saveFailed && (
        <p id="save-error" class={NOTICE_CLASS}>
          설정을 저장하지 못했어요. 같은 문제가 계속되면 플러그인 개발자에게 알려 주세요.
        </p>
      )}
      {cacheBackoffActive && (
        <p
          id="cache-backoff-diagnostic"
          class="m-0 flex items-start gap-1.5 text-xs leading-[1.45] text-ui-muted"
        >
          <TriangleAlert
            size={14}
            strokeWidth={1.7}
            aria-hidden="true"
            class="mt-px shrink-0 text-ui-warn"
          />
          <span>프롬프트 앞부분이 계속 바뀌어 캐싱을 잠시 멈췄어요.</span>
        </p>
      )}
    </>
  );
}
