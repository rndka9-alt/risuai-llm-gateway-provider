import type { LlmMessage } from 'llm-io';
import type { SimulationScenario } from '../scenario-contract';
import { makeBlock, makeMessage, mutateBlock, request } from './fixture-builders';

// 컨텍스트 스케일 프로필. characters/4 = 시뮬 토큰이며, 한국어 실프롬프트의
// 실토큰은 추정치의 약 1.4배(실측 58.7k est ↔ 82.8k real)이므로 30k/80k/120k는
// 실토큰 기준 어림값이다. 30k/80k/120k는 실사용 배분을 따라 로어북·장기기억
// (하이파 할당)을 함께 스케일한 "워크로드" 축이고, hist-*는 고정 블록을 80k
// 값으로 둔 채 히스토리 턴수만 바꾼 "컨텍스트 크기 단독" 축이다.
interface ManualSummaryScale {
  id: string;
  initialTurns: number;
  lorebookCharacters: number;
  memoryCharacters: number;
  summaryCharacters: number;
  // 전이 t(요청 t-1→t)가 t % period === 1이면 요약을 유지한다. 실측 mask는
  // [유지, 변동, 변동]의 반복(period 3). 미지정이면 매 전이 변동(worst case).
  stableSummaryPeriod?: number;
}

export const MANUAL_SUMMARY_SCALES: readonly ManualSummaryScale[] = [
  {
    id: 'floor-80k',
    initialTurns: 2,
    lorebookCharacters: 2_000,
    memoryCharacters: 2_400,
    summaryCharacters: 8_000,
  },
  {
    id: 'typical-110k',
    initialTurns: 28,
    lorebookCharacters: 8_000,
    memoryCharacters: 15_200,
    summaryCharacters: 34_400,
  },
  {
    id: 'ceiling-150k',
    initialTurns: 32,
    lorebookCharacters: 16_000,
    memoryCharacters: 24_000,
    summaryCharacters: 48_000,
  },
  {
    id: 'typical-110k-mixed',
    initialTurns: 28,
    lorebookCharacters: 8_000,
    memoryCharacters: 15_200,
    summaryCharacters: 34_400,
    stableSummaryPeriod: 3,
  },
  {
    id: 'hist-2t',
    initialTurns: 2,
    lorebookCharacters: 8_000,
    memoryCharacters: 15_200,
    summaryCharacters: 34_400,
  },
  {
    id: 'hist-32t',
    initialTurns: 32,
    lorebookCharacters: 8_000,
    memoryCharacters: 15_200,
    summaryCharacters: 34_400,
  },
];

// 2026-07 실측 적자 사건의 박제. 프리셋 스크립트가 매턴 currentChat.State에
// 쓰는 수동 요약을 {{dictelement::...}}로 렌더링해, 요약 블록이 매턴 미세
// 변동한다. 07과 달리 요약이 채팅을 대체하지 않고 전체 히스토리 '앞'에 얹히는
// 추가형 구조라, 얕은 앵커 히트만 남고 요약 뒤 히스토리가 매턴 재쓰기된다.
// 블록 비율은 실측 4요청 구조(80k 프로필)를 따르고, 스케일별 손익 비교를 위해
// 히스토리·로어북·장기기억만 프로필로 바꾼다.
export function createManualSummaryAdditiveScenario(scale: ManualSummaryScale): SimulationScenario {
  const recentWindowTurns = 5;
  const totalRequests = 8;
  const memoryAppearsAtRequest = 2;
  const prefix = `mas-${scale.id}`;

  const lorebookNoteCharacters = scale.lorebookCharacters / 5;
  const head = [
    makeMessage('system', makeBlock(`${prefix}-head-main`, 8_000)),
    makeMessage('user', makeBlock(`${prefix}-lore-note-1`, lorebookNoteCharacters)),
    makeMessage('user', makeBlock(`${prefix}-lore-note-2`, lorebookNoteCharacters)),
    makeMessage('user', makeBlock(`${prefix}-lore-note-3`, lorebookNoteCharacters)),
    makeMessage('user', makeBlock(`${prefix}-lore-note-4`, lorebookNoteCharacters)),
    makeMessage('user', makeBlock(`${prefix}-lore-note-5`, lorebookNoteCharacters)),
    makeMessage('system', makeBlock(`${prefix}-head-rule-1`, 2_800)),
    makeMessage('system', makeBlock(`${prefix}-head-rule-2`, 2_200)),
    makeMessage('user', makeBlock(`${prefix}-head-persona`, 2_000)),
  ];
  const longTermMemory = makeMessage(
    'user',
    makeBlock(`${prefix}-long-term-memory`, scale.memoryCharacters),
  );
  const summaryBase = makeBlock(`${prefix}-manual-summary`, scale.summaryCharacters);
  const midFixedNotes = [
    makeMessage('user', makeBlock(`${prefix}-mid-note-a`, 1_100)),
    makeMessage('user', makeBlock(`${prefix}-mid-note-b`, 100)),
  ];
  const tailSystems = [4_400, 3_900, 430, 1_400, 3_900].map((characters, index) =>
    makeMessage('system', makeBlock(`${prefix}-tail-system-${index + 1}`, characters)),
  );
  const tailNote = makeMessage('user', makeBlock(`${prefix}-tail-note`, 90));
  const tailFormat = makeMessage('user', makeBlock(`${prefix}-tail-format`, 240));
  const statusBase = makeBlock(`${prefix}-tail-status`, 5_800);
  const tailPostamble = makeMessage('user', makeBlock(`${prefix}-tail-postamble`, 2_000));

  const turns: LlmMessage[][] = [];
  for (let turn = 1; turn <= scale.initialTurns + totalRequests - 1; turn += 1) {
    turns.push([
      makeMessage('user', makeBlock(`${prefix}-chat-user-${turn}`, 500)),
      makeMessage('assistant', makeBlock(`${prefix}-chat-assistant-${turn}`, 3_800)),
    ]);
  }

  // 최근 N턴은 tail system 블록 '뒤'에 배치되고, 턴이 지나면 가장 오래된 턴이
  // system 앞의 본 히스토리로 이주한다 — 실측된 분할 채팅 구조.
  let summaryMutations = 0;
  const requests = Array.from({ length: totalRequests }, (_, requestIndex) => {
    const stableTransition =
      scale.stableSummaryPeriod !== undefined && requestIndex % scale.stableSummaryPeriod === 1;
    if (requestIndex > 0 && !stableTransition) summaryMutations += 1;
    const turnCount = scale.initialTurns + requestIndex;
    const recentStart = Math.max(0, turnCount - recentWindowTurns);
    const olderTurns = turns.slice(0, recentStart).flat();
    const recentTurns = turns.slice(recentStart, turnCount).flat();
    return request(
      [
        ...head,
        ...(requestIndex >= memoryAppearsAtRequest ? [longTermMemory] : []),
        makeMessage('system', mutateBlock(summaryBase, summaryMutations)),
        ...olderTurns,
        ...midFixedNotes,
        ...tailSystems,
        ...recentTurns,
        tailNote,
        makeMessage('user', makeBlock(`${prefix}-current-input-${requestIndex + 1}`, 250)),
        tailFormat,
        makeMessage('user', mutateBlock(statusBase, requestIndex)),
        tailPostamble,
      ],
      requestIndex === 0 ? 0 : 5,
    );
  });

  return {
    id: `13-manual-summary-additive-${scale.id}`,
    label: `state-mediated volatile summary above full history (${scale.id})`,
    requests,
  };
}
