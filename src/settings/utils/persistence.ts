import { setSettingsSaveFailed } from './signals';

// 프로바이더가 매 요청 인자를 라이브로 읽으므로 저장 버튼 없이 native change
// 시점에 바로 저장한다. 실패 표시는 다음 성공한 변경에서 해제한다.
export function persistSetting(save: () => Promise<void>): void {
  save().then(
    () => setSettingsSaveFailed(false),
    (error: unknown) => {
      setSettingsSaveFailed(true);
      console.error('[llm-gateway-provider] Failed to save settings', error);
    },
  );
}
