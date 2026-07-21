import {
  CACHE_ANCHOR_BANK_SLOT_STORAGE_KEY_PREFIX,
  CACHE_ANCHOR_STATE_STORAGE_KEY,
} from '../../constants';
import { cacheAnchorStateSchema, type CacheAnchorState } from '../schema';
import {
  cacheAnchorBankIndexSchema,
  type CacheAnchorBankIndex,
  type CacheAnchorBankSnapshot,
} from './schema';

let runtimeSnapshot: CacheAnchorBankSnapshot | null = null;
let runtimeSnapshotStorage: unknown;

// getItem은 cold-load 시점의 storage identity에 묶인 snapshot을 만들고 이후 슬롯
// 딥클론 read를 피한다. 반면 setItem은 commit 시점의 live risuai.pluginStorage에
// 써야 하므로 storage 객체를 캡처하지 않으며, 전체 쓰기 성공값만 snapshot으로 발행한다.

function createEmptySnapshot(): CacheAnchorBankSnapshot {
  return {
    consecutiveBankMisses: 0,
    lruSlots: [],
    statesBySlot: new Map(),
    unpersistedSlots: new Set(),
  };
}

function slotStorageKey(slot: number): string {
  return `${CACHE_ANCHOR_BANK_SLOT_STORAGE_KEY_PREFIX}${slot}`;
}

function parseStoredJson(raw: string, label: string): unknown | null {
  try {
    return JSON.parse(raw);
  } catch (error) {
    console.error(`[llm-gateway-provider] corrupted ${label}; ignoring it`, error);
    return null;
  }
}

async function loadIndexedSnapshot(index: CacheAnchorBankIndex): Promise<CacheAnchorBankSnapshot> {
  const storedStates = await Promise.all(
    index.lruSlots.map(async (slot) => {
      const raw = await risuai.pluginStorage.getItem(slotStorageKey(slot));
      if (typeof raw !== 'string' || raw === '') return null;

      const parsed = parseStoredJson(raw, `cache anchor bank slot ${slot}`);
      if (parsed === null) return null;
      const result = cacheAnchorStateSchema.safeParse(parsed);
      return result.success ? { slot, state: result.data } : null;
    }),
  );
  const statesBySlot = new Map<number, CacheAnchorState>();
  storedStates.forEach((storedState) => {
    if (storedState !== null) statesBySlot.set(storedState.slot, storedState.state);
  });
  const lruSlots = index.lruSlots.filter((slot) => statesBySlot.has(slot));

  if (lruSlots.length === 0 && index.lruSlots.length > 0) return createEmptySnapshot();
  return {
    consecutiveBankMisses: index.consecutiveBankMisses,
    lruSlots,
    statesBySlot,
    unpersistedSlots: new Set(),
  };
}

async function loadPersistedSnapshot(): Promise<CacheAnchorBankSnapshot> {
  const raw = await risuai.pluginStorage.getItem(CACHE_ANCHOR_STATE_STORAGE_KEY);
  if (typeof raw !== 'string' || raw === '') return createEmptySnapshot();

  const parsed = parseStoredJson(raw, 'cache anchor bank index');
  if (parsed === null) return createEmptySnapshot();

  const indexResult = cacheAnchorBankIndexSchema.safeParse(parsed);
  if (indexResult.success) return loadIndexedSnapshot(indexResult.data);

  // 기존 단일 키 state는 첫 슬롯으로 올린 뒤, 다음 성공 응답 commit에서 index와
  // 갱신된 슬롯을 함께 써 1회 마이그레이션한다. prepare만으로는 저장하지 않는다.
  const legacyStateResult = cacheAnchorStateSchema.safeParse(parsed);
  if (!legacyStateResult.success) return createEmptySnapshot();
  return {
    consecutiveBankMisses: 0,
    lruSlots: [0],
    statesBySlot: new Map([[0, legacyStateResult.data]]),
    unpersistedSlots: new Set([0]),
  };
}

export async function loadCacheAnchorBankSnapshot(): Promise<CacheAnchorBankSnapshot> {
  if (runtimeSnapshot !== null && runtimeSnapshotStorage === risuai.pluginStorage) {
    return runtimeSnapshot;
  }

  const loadedSnapshot = await loadPersistedSnapshot();
  runtimeSnapshot = loadedSnapshot;
  runtimeSnapshotStorage = risuai.pluginStorage;
  return loadedSnapshot;
}

export async function loadCacheAnchorBankMissCount(): Promise<number> {
  return (await loadCacheAnchorBankSnapshot()).consecutiveBankMisses;
}

export async function saveCacheAnchorBankUpdate(
  updatedSlot: number,
  nextSnapshot: CacheAnchorBankSnapshot,
): Promise<void> {
  const updatedState = nextSnapshot.statesBySlot.get(updatedSlot);
  if (updatedState === undefined) {
    throw new RangeError('Updated cache anchor bank slot must reference a state.');
  }
  const index: CacheAnchorBankIndex = {
    version: 1,
    consecutiveBankMisses: nextSnapshot.consecutiveBankMisses,
    lruSlots: [...nextSnapshot.lruSlots],
  };

  // 슬롯을 먼저 쓰고 index를 마지막에 publish한다. 레거시 이식 직후라면 아직
  // 슬롯 키가 없는 첫 엔트리도 함께 쓴다. index 쓰기까지 성공한 값만 런타임
  // snapshot으로 발행하며, 중간 실패로 남은 orphan 슬롯은 참조되지 않는다.
  const slotsToPersist = new Set(nextSnapshot.unpersistedSlots);
  slotsToPersist.add(updatedSlot);
  await Promise.all(
    [...slotsToPersist].map(async (slot) => {
      const state = nextSnapshot.statesBySlot.get(slot);
      if (state === undefined) {
        throw new RangeError('Persisted cache anchor bank slot must reference a state.');
      }
      const storedState = cacheAnchorStateSchema.parse(state);
      await risuai.pluginStorage.setItem(slotStorageKey(slot), JSON.stringify(storedState));
    }),
  );
  await risuai.pluginStorage.setItem(CACHE_ANCHOR_STATE_STORAGE_KEY, JSON.stringify(index));
  runtimeSnapshot = { ...nextSnapshot, unpersistedSlots: new Set() };
  runtimeSnapshotStorage = risuai.pluginStorage;
}
