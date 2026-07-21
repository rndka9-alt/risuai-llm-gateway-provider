import { z } from 'zod';
import { ADMITTED_ANCHOR_SURVIVAL_COUNT } from '../constants';

const messageFingerprintSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  hash: z.string(),
  tokenEstimate: z.number(),
  // v0.9 이하 state에는 이 필드가 없다. 16K 쓰기 가드에서 기존 tokenEstimate로
  // 호환 읽기하고, 다음 성공 요청 저장부터 텍스트 전용 추정치로 교체한다.
  textTokenEstimate: z.number().optional(),
});

const anchorAdmissionSchema = z.object({
  anchorIndex: z.number().int().nonnegative(),
  // 0은 최초 관측, 1은 과거 버전의 진행 중 후보, 2는 admission 완료 상태다.
  // 조기 승격도 2로 정규화해 v0.8 상태·롤백 호환을 유지한다.
  consecutiveSurvivals: z.number().int().min(0).max(ADMITTED_ANCHOR_SURVIVAL_COUNT),
  admitted: z.boolean(),
  // 구버전 전면 검증형 상태는 선택적 위험 판별 기록이 없으므로 true로 읽어
  // 이미 관찰 중이던 후보를 갑자기 공격적으로 마킹하지 않는다.
  requiresValidation: z.boolean().default(true),
});

// 구버전 frontierIndex 상태는 anchorIndexes가 없어 파싱에 실패하고 새 epoch로
// 회복한다. 캐시 최적화 상태라 손실이 무해하고, 경계를 추측해 승계하는 것보다 안전하다.
export const cacheAnchorStateSchema = z
  .object({
    anchorIndexes: z.array(z.number().int().nonnegative()).max(4),
    // 구버전 상태는 후보 검증 기록이 없으므로 빈 배열로 안전 마이그레이션한다.
    // 기존 앵커를 곧바로 admitted로 간주하면 업데이트 직후 미검증 write가 다시
    // 발생할 수 있어, 두 번의 생존 확인을 새로 거친다.
    anchorAdmissions: z.array(anchorAdmissionSchema).max(4).default([]),
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
          code: 'custom',
          message: 'anchor index must reference a fingerprint',
          path: ['anchorIndexes', position],
        });
      }
      if (position > 0 && state.anchorIndexes[position - 1] >= anchorIndex) {
        context.addIssue({
          code: 'custom',
          message: 'anchor indexes must be strictly ascending',
          path: ['anchorIndexes', position],
        });
      }
    });
    state.anchorAdmissions.forEach((admission, position) => {
      if (!state.anchorIndexes.includes(admission.anchorIndex)) {
        context.addIssue({
          code: 'custom',
          message: 'anchor admission must reference an anchor index',
          path: ['anchorAdmissions', position, 'anchorIndex'],
        });
      }
      if (
        position > 0 &&
        state.anchorAdmissions[position - 1].anchorIndex >= admission.anchorIndex
      ) {
        context.addIssue({
          code: 'custom',
          message: 'anchor admissions must be strictly ascending',
          path: ['anchorAdmissions', position, 'anchorIndex'],
        });
      }
      if (admission.admitted && admission.consecutiveSurvivals < ADMITTED_ANCHOR_SURVIVAL_COUNT) {
        context.addIssue({
          code: 'custom',
          message: 'admitted anchor must use the normalized survival count',
          path: ['anchorAdmissions', position, 'admitted'],
        });
      }
    });
  });

export type MessageFingerprint = z.infer<typeof messageFingerprintSchema>;
export type AnchorAdmission = z.infer<typeof anchorAdmissionSchema>;
export type CacheAnchorState = z.infer<typeof cacheAnchorStateSchema>;
