import { calculateNetSavedTokens, type CacheLedger } from '../../ledger';

export interface LedgerDisplay {
  amountText: string;
  tone: 'gain' | 'loss' | 'neutral';
}

export function formatTokenCount(value: number): string {
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (absolute >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return `${value}`;
}

// 손익을 대표값 하나로 보여준다 — 실측 절감 USD가 있으면 그것을, 없으면
// 입력 정가 토큰 등가(0.9R − 0.25W)를 쓴다. 원시 읽기/쓰기는 팝오버 상세로.
export function buildLedgerDisplay(ledger: CacheLedger): LedgerDisplay {
  const hasRecords =
    ledger.readTokens !== 0 ||
    ledger.writeTokens !== 0 ||
    ledger.costUsd !== 0 ||
    ledger.savedUsd !== 0;
  if (!hasRecords) {
    return { amountText: '아직 기록 없음', tone: 'neutral' };
  }

  const useUsd = ledger.savedUsd !== 0;
  const amountValue = useUsd ? ledger.savedUsd : calculateNetSavedTokens(ledger);
  const sign = amountValue >= 0 ? '+' : '-';
  const absolute = Math.abs(amountValue);
  const amountText = useUsd
    ? `${sign}$${absolute.toFixed(4)}`
    : `${sign}${formatTokenCount(absolute)} tokens`;

  return {
    amountText,
    tone: amountValue >= 0 ? 'gain' : 'loss',
  };
}
