import type { GoldenTrajectory } from '../core/replay';
import {
  createLargeStablePrefixAdmissionTrajectory,
  createLargeStablePrefixInvalidatedAfterAdmissionTrajectory,
  createSuppressedFrontierBranchBoundaryTrajectory,
} from './golden/admission-trajectories';
import {
  createContentAddressedRoundRobinTrajectory,
  createCrossChurnEvictionTrajectory,
  createMultiRoomRoundRobinTrajectory,
} from './golden/bank-trajectories';
import {
  createAppendOnlyTrajectory,
  createChurnOscillatingTrajectory,
  createChurnThenStableTrajectory,
  createContextTrimmingTrajectory,
  createHypaSummaryTrajectory,
  createLeadingCbsTrapTrajectory,
  createLoreToggleTrajectory,
  createLuaPostEditTrajectory,
  createRerollTrajectory,
  createReverseDepthTrajectory,
  createRoomSwitchTrajectory,
  createTtlGapTrajectory,
} from './golden/foundational-trajectories';
import {
  createManualSummaryAdditiveTrajectory,
  MANUAL_SUMMARY_SCALES,
} from './golden/manual-summary-trajectories';
import { scaleGoldenTrajectory } from './golden/scale-golden-trajectory';
import {
  createGroupSpeakerRotationTrajectory,
  createMidHistoryEditsTrajectory,
  createTrimSaturationTrajectory,
} from './golden/usage-trajectories';

export function createGoldenTrajectories(): readonly GoldenTrajectory[] {
  const trajectories = [
    createAppendOnlyTrajectory(),
    createLeadingCbsTrapTrajectory(),
    createReverseDepthTrajectory(),
    createRerollTrajectory(),
    createLoreToggleTrajectory(),
    createContextTrimmingTrajectory(),
    createHypaSummaryTrajectory(),
    createLuaPostEditTrajectory(),
    createRoomSwitchTrajectory(),
    createTtlGapTrajectory(),
    createChurnThenStableTrajectory(),
    createChurnOscillatingTrajectory(),
    ...MANUAL_SUMMARY_SCALES.map(createManualSummaryAdditiveTrajectory),
    createTrimSaturationTrajectory(),
    createMultiRoomRoundRobinTrajectory(),
    createGroupSpeakerRotationTrajectory(),
    createMidHistoryEditsTrajectory(),
    createSuppressedFrontierBranchBoundaryTrajectory(),
    createLargeStablePrefixAdmissionTrajectory(),
    createLargeStablePrefixInvalidatedAfterAdmissionTrajectory(),
    createContentAddressedRoundRobinTrajectory(),
    createCrossChurnEvictionTrajectory(),
  ];
  return trajectories.map(scaleGoldenTrajectory);
}
