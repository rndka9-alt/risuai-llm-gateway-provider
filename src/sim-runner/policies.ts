import type { ReplayCachePolicyFactory } from '../sim';
import { createNoCachePolicy, createProductionCachePolicy } from '../sim-adapters/cache-policies';

export const STANDALONE_POLICY_NAMES = ['production', 'no-cache'] as const;

export type StandalonePolicyName = (typeof STANDALONE_POLICY_NAMES)[number];

export function resolveStandalonePolicyFactory(
  policyName: StandalonePolicyName,
): ReplayCachePolicyFactory {
  if (policyName === 'production') {
    return createProductionCachePolicy;
  }
  if (policyName === 'no-cache') {
    return createNoCachePolicy;
  }
  throw new Error(`Unsupported standalone policy: ${policyName}`);
}
