import { createEmptyCacheLedger, type CacheLedger } from './schema';

// pluginStorage는 변경 알림이 없으므로 요청부와 설정 UI가 같은 최신 원장을 보도록
// 런타임 snapshot을 발행한다. 영속 쓰기에 성공한 값만 publish한다.
type CacheLedgerListener = () => void;

const cacheLedgerListeners = new Set<CacheLedgerListener>();
let cacheLedgerSnapshot = createEmptyCacheLedger();

export function getCacheLedgerSnapshot(): CacheLedger {
  return cacheLedgerSnapshot;
}

export function subscribeCacheLedger(listener: CacheLedgerListener): () => void {
  cacheLedgerListeners.add(listener);
  return () => cacheLedgerListeners.delete(listener);
}

export function publishCacheLedger(ledger: CacheLedger): void {
  cacheLedgerSnapshot = ledger;
  for (const listener of cacheLedgerListeners) listener();
}
