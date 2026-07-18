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
