import type { UserErrorCode } from '../error-codes';

const CONTINUED_FAILURE_GUIDANCE =
  '같은 문제가 계속되면 아래 오류 정보를 플러그인 개발자에게 알려 주세요.';
const CONTINUED_FAILURE_WITHOUT_DETAILS_GUIDANCE =
  '같은 문제가 계속되면 플러그인 개발자에게 알려 주세요.';

export function withFailureDetails(
  summary: string,
  detail: string,
  errorCode: UserErrorCode,
  status?: number,
): string {
  const hasDetails = detail !== '' || status !== undefined;
  const guidance = hasDetails
    ? CONTINUED_FAILURE_GUIDANCE
    : CONTINUED_FAILURE_WITHOUT_DETAILS_GUIDANCE;
  if (!hasDetails) return `${summary} (${errorCode})\n${guidance}`;

  const detailsTitle =
    status === undefined
      ? `자세한 오류 정보 (${errorCode})`
      : `자세한 오류 정보 (${errorCode}, 오류 코드 ${status})`;
  return detail === ''
    ? `${summary}\n${guidance}\n\n${detailsTitle}`
    : `${summary}\n${guidance}\n\n${detailsTitle}\n${detail}`;
}
