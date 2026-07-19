import { ADMITTED_ANCHOR_SURVIVAL_COUNT, ANCHOR_ADMISSION_SURVIVAL_THRESHOLD } from '../constants';
import type { AnchorAdmission, CacheAnchorState } from '../state/schema';

export function resolveAnchorAdmissions(
  previousState: CacheAnchorState | null,
  anchorIndexes: readonly number[],
  prefixLength: number,
  requiresValidationIndexes: ReadonlySet<number>,
): AnchorAdmission[] {
  const previousAdmissions = new Map(
    (previousState === null ? [] : previousState.anchorAdmissions).map((admission) => [
      admission.anchorIndex,
      admission,
    ]),
  );
  const observations = anchorIndexes.map((anchorIndex): AnchorAdmission => {
    const previousAdmission = previousAdmissions.get(anchorIndex);
    const survived = previousAdmission !== undefined && prefixLength > anchorIndex;
    if (!survived) {
      return {
        admitted: false,
        anchorIndex,
        consecutiveSurvivals: 0,
        requiresValidation: requiresValidationIndexes.has(anchorIndex),
      };
    }
    if (previousAdmission.admitted) return previousAdmission;
    return {
      admitted: false,
      anchorIndex,
      consecutiveSurvivals: Math.min(
        ANCHOR_ADMISSION_SURVIVAL_THRESHOLD,
        previousAdmission.consecutiveSurvivals + 1,
      ),
      requiresValidation: previousAdmission.requiresValidation,
    };
  });

  return observations.map((admission) =>
    admission.admitted || admission.consecutiveSurvivals < ANCHOR_ADMISSION_SURVIVAL_THRESHOLD
      ? admission
      : {
          ...admission,
          admitted: true,
          consecutiveSurvivals: ADMITTED_ANCHOR_SURVIVAL_COUNT,
        },
  );
}
