import { useState } from 'preact/hooks';
import { LlmFlagsField } from './LlmFlagsField';
import { ModelField } from './ModelField';
import { ServiceTierField } from './ServiceTierField';
import { SettingsAccordion } from './SettingsAccordion';
import { StreamingModeField } from './StreamingModeField';

export function AdvancedSettingsAccordion() {
  const [expanded, setExpanded] = useState(false);

  return (
    <SettingsAccordion
      id="advanced-settings"
      title="고급"
      expanded={expanded}
      onToggle={() => setExpanded((currentExpanded) => !currentExpanded)}
    >
      <ModelField />
      <StreamingModeField />
      <ServiceTierField />
      <LlmFlagsField />
      <span class="text-xs leading-none text-ui-content/70">버전: {__VERSION__}</span>
    </SettingsAccordion>
  );
}
