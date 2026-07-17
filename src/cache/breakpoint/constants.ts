import type { LlmMessageRole } from 'llm-io';

// llm-io는 assistant 메시지를 문자열 content로 직렬화해 breakpoint 마킹이
// 유실된다(to-openai-message.ts). 실측에서도 llmgateway는 assistant 지점 마커를
// 200으로 수락하지만 1,531토큰 프리픽스의 cache write가 0이라 엔트리를 만들지 않았다.
// content part 배열이 유지되는 system/user에만 마킹하고, 아니면 앞쪽으로 물러난다.
export const MARKABLE_ROLES: ReadonlySet<LlmMessageRole> = new Set(['system', 'user']);
