export type StreamingMode = 'off' | 'decoupled';

export function resolveStreamingMode(value: string | undefined): StreamingMode {
  const trimmed = value?.trim();
  if (trimmed === 'decoupled') return 'decoupled';
  // iframe→본체 브릿지 factory.ts guest의 collectTransferables가 ReadableStream을 수집하지 않아
  // 기존 stream 저장값은 DataCloneError를 피할 수 있는 decoupled로 정규화한다.
  if (trimmed === 'stream') return 'decoupled';
  return 'off';
}
