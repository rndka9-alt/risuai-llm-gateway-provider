import type { LlmMessage, LlmMessageRole } from 'llm-io';
import type { ScenarioRequest } from '../scenario-contract';

export function makeMessage(role: LlmMessageRole, text: string): LlmMessage {
  return { role, content: [{ type: 'text', text }] };
}

export function makeBlock(label: string, characters: number): string {
  const sentence = `[${label}] Stable offline simulation text records maps, routes, archive shelves, weather notes, and numbered observations. `;
  return sentence.repeat(Math.ceil(characters / sentence.length)).slice(0, characters);
}

export function request(messages: readonly LlmMessage[], elapsedMinutes = 1): ScenarioRequest {
  return { elapsedMinutes, messages: [...messages] };
}

// 상태 매개 휘발 재현: 변이를 누적 적용해 인접 요청 간 정확히 한 지점의 두
// 글자만 달라지게 한다(실측: 23.5k자 요약 블록이 전이마다 1~2자, 오프셋은 매번
// 다름). base 기준 단발 치환은 이전 위치 복원 + 새 위치 변경으로 4자가 달라져
// 실측과 어긋난다. mutationCount 0은 원본 그대로라 블록 선두도 보존된다.
export function mutateBlock(base: string, mutationCount: number): string {
  let text = base;
  for (let mutation = 1; mutation <= mutationCount; mutation += 1) {
    const offset = (mutation * 7_919) % (text.length - 2);
    text = `${text.slice(0, offset)}${String(mutation % 100).padStart(2, '0')}${text.slice(offset + 2)}`;
  }
  return text;
}
