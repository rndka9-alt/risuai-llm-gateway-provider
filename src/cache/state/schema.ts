import { z } from 'zod';

const messageFingerprintSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  hash: z.string(),
  tokenEstimate: z.number(),
});

// 구버전 frontierIndex 상태는 anchorIndexes가 없어 파싱에 실패하고 새 epoch로
// 회복한다. 캐시 최적화 상태라 손실이 무해하고, 경계를 추측해 승계하는 것보다 안전하다.
export const cacheAnchorStateSchema = z
  .object({
    anchorIndexes: z.array(z.number().int().nonnegative()).max(4),
    consecutiveEpochResets: z.number().int().nonnegative().default(0),
    // 위치 판별형 2-strike의 frontier 연속 사망 횟수. 구버전 상태는 필드가
    // 없으므로 0으로 마이그레이션하고, 구버전으로 롤백하면 소실 후 0에서
    // 재시작한다(안전 리셋). 성공 응답 후에만 commit되는 anchor state에 실려
    // 취소·실패 요청이 카운터를 오염시키지 못한다.
    consecutiveFrontierDeaths: z.number().int().nonnegative().default(0),
    fingerprints: z.array(messageFingerprintSchema),
  })
  .superRefine((state, context) => {
    state.anchorIndexes.forEach((anchorIndex, position) => {
      if (anchorIndex >= state.fingerprints.length) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'anchor index must reference a fingerprint',
          path: ['anchorIndexes', position],
        });
      }
      if (position > 0 && state.anchorIndexes[position - 1] >= anchorIndex) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'anchor indexes must be strictly ascending',
          path: ['anchorIndexes', position],
        });
      }
    });
  });

export type MessageFingerprint = z.infer<typeof messageFingerprintSchema>;
export type CacheAnchorState = z.infer<typeof cacheAnchorStateSchema>;
