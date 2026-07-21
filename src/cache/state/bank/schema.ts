import { z } from 'zod';
import { BANK_MAX_STATES } from '../../constants';
import type { CacheAnchorState } from '../schema';

// lruSlots는 MRU → LRU 순서다. 슬롯 번호는 저장 샤드 주소일 뿐 방 신원이
// 아니며, 상태 선택에는 fingerprint 공통 프리픽스만 사용한다.
export const cacheAnchorBankIndexSchema = z
  .object({
    version: z.literal(1),
    consecutiveBankMisses: z.number().int().nonnegative(),
    lruSlots: z
      .array(
        z
          .number()
          .int()
          .min(0)
          .max(BANK_MAX_STATES - 1),
      )
      .max(BANK_MAX_STATES),
  })
  .superRefine((index, context) => {
    const uniqueSlots = new Set(index.lruSlots);
    if (uniqueSlots.size !== index.lruSlots.length) {
      context.addIssue({
        code: 'custom',
        message: 'LRU slots must be unique',
        path: ['lruSlots'],
      });
    }
  });

export interface CacheAnchorBankSnapshot {
  readonly consecutiveBankMisses: number;
  readonly lruSlots: readonly number[];
  readonly statesBySlot: ReadonlyMap<number, CacheAnchorState>;
  // 레거시 단일 키에서 메모리로 이식됐지만 아직 슬롯 키에는 쓰이지 않은 상태.
  // 첫 성공 응답 commit이 선택된 슬롯과 함께 영속화한다.
  readonly unpersistedSlots: ReadonlySet<number>;
}

export type CacheAnchorBankIndex = z.infer<typeof cacheAnchorBankIndexSchema>;
