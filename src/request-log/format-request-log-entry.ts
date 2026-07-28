import type { RequestLogEntry } from './types';

// 상세 보기와 복사 버튼이 공유하는 표시용 텍스트. 채팅 내용은 기록 시점에 이미
// 걷어냈으므로 여기선 배치만 담당한다.
export function formatRequestLogEntry(entry: RequestLogEntry): string {
  const lines: string[] = [];
  const duration = entry.durationMs === undefined ? '' : ` · ${(entry.durationMs / 1000).toFixed(1)}s`;
  lines.push(`[${entry.startedAtIso}] ${entry.model} · streaming=${entry.streamingMode}${duration}`);

  if (entry.request === undefined) {
    lines.push('', '요청: wire 전송 기록 없음 (전송 전 실패)');
  } else {
    lines.push(
      '',
      `요청 ${entry.request.method} ${entry.request.url}`,
      `요청 헤더: ${JSON.stringify(entry.request.headers, null, 2)}`,
      '요청 본문:',
      entry.request.body,
    );
  }

  if (entry.response !== undefined) {
    lines.push(
      '',
      `응답 HTTP ${entry.response.status}`,
      `응답 헤더: ${JSON.stringify(entry.response.headers, null, 2)}`,
      '응답 본문:',
      entry.response.body,
    );
  }

  if (entry.outcome === undefined) {
    lines.push('', '결과: 진행 중');
  } else if (entry.outcome.kind === 'success') {
    const finishReason =
      entry.outcome.finishReason === undefined ? '' : ` (finishReason=${entry.outcome.finishReason})`;
    // llm-io 정규화 usage는 표시하지 않는다 — wire 원문 usage가 응답 본문에 이미
    // 있어, 표기가 다른 두 사용량이 나란히 보이면 노이즈가 된다 (outcome엔 유지).
    lines.push('', `결과: 성공${finishReason}`);
  } else {
    lines.push('', '결과: 실패', entry.outcome.content);
  }

  return lines.join('\n');
}
