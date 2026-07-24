import { NOTICE_CLASS } from '../../constants';
import { useSettingsSignals } from '../../../utils/signals';

export function SettingsNotices() {
  const { saveFailed } = useSettingsSignals();

  return (
    <>
      {saveFailed && (
        <p id="save-error" class={NOTICE_CLASS}>
          설정을 저장하지 못했어요. 같은 문제가 계속되면 플러그인 개발자에게 알려 주세요.
        </p>
      )}
    </>
  );
}
