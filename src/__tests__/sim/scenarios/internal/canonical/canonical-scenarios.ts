import type { SimulationScenario } from '../scenario-contract';
import {
  createLargeStablePrefixAdmissionScenario,
  createLargeStablePrefixInvalidatedAfterAdmissionScenario,
  createSuppressedFrontierBranchBoundaryScenario,
} from './admission-scenarios';
import {
  createContentAddressedRoundRobinScenario,
  createCrossChurnEvictionScenario,
  createMultiRoomRoundRobinScenario,
} from './bank-scenarios';
import {
  createAppendOnlyScenario,
  createChurnOscillatingScenario,
  createChurnThenStableScenario,
  createContextTrimmingScenario,
  createHypaSummaryScenario,
  createLeadingCbsTrapScenario,
  createLoreToggleScenario,
  createLuaPostEditScenario,
  createRerollScenario,
  createReverseDepthScenario,
  createRoomSwitchScenario,
  createTtlGapScenario,
} from './foundational-scenarios';
import {
  createManualSummaryAdditiveScenario,
  MANUAL_SUMMARY_SCALES,
} from './manual-summary-scenarios';
import { scaleCanonicalScenario } from './scale-canonical-scenario';
import {
  createGroupSpeakerRotationScenario,
  createMidHistoryEditsScenario,
  createTrimSaturationScenario,
} from './usage-scenarios';

export function createCanonicalScenarios(): readonly SimulationScenario[] {
  const scenarios = [
    createAppendOnlyScenario(),
    createLeadingCbsTrapScenario(),
    createReverseDepthScenario(),
    createRerollScenario(),
    createLoreToggleScenario(),
    createContextTrimmingScenario(),
    createHypaSummaryScenario(),
    createLuaPostEditScenario(),
    createRoomSwitchScenario(),
    createTtlGapScenario(),
    createChurnThenStableScenario(),
    createChurnOscillatingScenario(),
    ...MANUAL_SUMMARY_SCALES.map(createManualSummaryAdditiveScenario),
    createTrimSaturationScenario(),
    createMultiRoomRoundRobinScenario(),
    createGroupSpeakerRotationScenario(),
    createMidHistoryEditsScenario(),
    createSuppressedFrontierBranchBoundaryScenario(),
    createLargeStablePrefixAdmissionScenario(),
    createLargeStablePrefixInvalidatedAfterAdmissionScenario(),
    createContentAddressedRoundRobinScenario(),
    createCrossChurnEvictionScenario(),
  ];
  return scenarios.map(scaleCanonicalScenario);
}
