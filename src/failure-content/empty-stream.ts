import type { LlmUsage } from 'llm-io';
import { USER_ERROR_CODES } from './error-codes';
import { serializeObject } from './internal/error-detail';
import { withFailureDetails } from './internal/failure-details';

export interface EmptyStreamDiagnostics {
  finishReason: string | undefined;
  reasoningDeltaCount: number;
  streamEventCount: number;
  usage: LlmUsage | undefined;
}

/** 내용 없이 끝난 스트림을 무음 성공 대신 원인별 실패 안내로 바꿉니다. */
export function toEmptyStreamFailureContent(diagnostics: EmptyStreamDiagnostics): string {
  const detail = serializeObject(diagnostics);

  // reasoning 델타를 노출하지 않는 모델은 usage의 reasoning 토큰으로만 소진이 드러난다
  // (실측: SSE 24건 중 4건이 reasoning 토큰이 있는데 델타 미노출).
  const reasoningTokens = diagnostics.usage?.reasoningTokens;
  const consumedReasoning =
    diagnostics.reasoningDeltaCount > 0 || (reasoningTokens !== undefined && reasoningTokens > 0);
  if (diagnostics.finishReason === 'length' && consumedReasoning) {
    return withFailureDetails(
      '모델이 내부 추론(reasoning)에 출력 한도를 모두 사용해서 본문 없이 끝났어요.\n' +
        'RisuAI의 응답 최대 토큰을 늘리거나, 플러그인 설정에서 reasoning 수준을 낮춰 보세요.',
      detail,
      USER_ERROR_CODES.emptyStreamReasoningLimit,
    );
  }
  // 스트리밍 off 전환 유도는 우회이자 진단이다 — 같은 본문이라도 generate() 경로는
  // JSON 파싱을 타서 구체적인 오류가 그대로 드러난다.
  const RETRY_GUIDANCE =
    '일시적인 문제일 수 있으니 다시 시도해 보시고, 반복되면 플러그인 설정에서 ' +
    "스트리밍 모드를 '사용 안 함'으로 바꿔 다시 시도해 보세요. 더 자세한 오류가 보일 수 있어요.";
  if (diagnostics.streamEventCount === 0) {
    // streamEventCount는 wire 청크가 아니라 정규화 이벤트 수라, 내용 없는 필러 청크만
    // 받은 경우도 0이 된다 — 세부 구분은 진단 JSON이 담당한다.
    return withFailureDetails(
      `LLM Gateway에서 빈 응답을 받았어요.\n${RETRY_GUIDANCE}`,
      detail,
      USER_ERROR_CODES.emptyStreamWithoutEvents,
    );
  }
  return withFailureDetails(
    `LLM Gateway 응답이 내용 없이 끝났어요.\n${RETRY_GUIDANCE}`,
    detail,
    USER_ERROR_CODES.emptyStreamWithoutText,
  );
}
