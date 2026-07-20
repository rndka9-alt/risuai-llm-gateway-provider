import type { LlmMessage } from 'llm-io';
import { neutralScenarios } from './neutral-authored-scenarios';
import type { GoldenTrajectory } from './replay';

// neutral-authored-scenarios.ts는 블라인드 설계 에이전트의 산출물이다. 설계자는
// 비교 대상 정책들의 코드를 일절 보지 않은 채(레포 탐색 금지) 도메인 브리프만으로
// 작성했다. 여기서는 벤치마크 하네스 형태로 변환만 한다.

export interface WeightedTrajectory {
  trajectory: GoldenTrajectory;
  weight: number;
}

export function createAuthoredTrajectories(): readonly WeightedTrajectory[] {
  return neutralScenarios.map((scenario) => ({
    trajectory: {
      id: scenario.id,
      label: scenario.label,
      requests: scenario.requests.map((request) => ({
        elapsedMinutes: request.elapsedMinutes,
        messages: request.messages.map(
          (message): LlmMessage => ({
            role: message.role,
            content: [{ type: 'text', text: message.text }],
          }),
        ),
      })),
    },
    weight: scenario.weight,
  }));
}
