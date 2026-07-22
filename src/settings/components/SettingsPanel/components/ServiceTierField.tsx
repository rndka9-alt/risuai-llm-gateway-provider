import { HelpTooltip } from './HelpTooltip';
import { ToggleControl } from './ToggleControl';
import { FIELD_CAPTION_CLASS, FIELD_CLASS } from '../../constants';
import { persistSetting } from '../../../utils/persistence';
import { updateSettingsSnapshot, useSettingsSnapshot } from '../../../utils/settings-snapshot';
import { saveServiceTier } from '../../../utils/storage';

export function ServiceTierField() {
  const { serviceTier } = useSettingsSnapshot();

  return (
    <div class={FIELD_CLASS}>
      <span class="flex min-h-4 items-center gap-1">
        <span class={FIELD_CAPTION_CLASS}>서비스 티어</span>
        <HelpTooltip id="service-tier-tooltip" label="Flex 서비스 티어 도움말">
          입력·출력 비용이 절반으로 줄어요. 대신 서버 상황에 따라 응답이 늦어지거나 실패할 수
          있어요.
        </HelpTooltip>
      </span>
      <ToggleControl
        id="service-tier"
        ariaLabel="Flex 서비스 티어 사용"
        checked={serviceTier === 'flex'}
        label={serviceTier === 'flex' ? 'Flex' : 'Gateway 기본'}
        onChange={(checked) => {
          const nextServiceTier = checked ? 'flex' : undefined;
          updateSettingsSnapshot({ serviceTier: nextServiceTier });
          persistSetting(() => saveServiceTier(nextServiceTier));
        }}
      />
    </div>
  );
}
