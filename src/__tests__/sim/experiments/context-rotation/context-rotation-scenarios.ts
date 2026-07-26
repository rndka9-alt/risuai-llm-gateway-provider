import type { LlmMessage } from 'llm-io';
import type { ScenarioRequest, SimulationScenario } from '../../scenarios';

/**
 * 컨텍스트 회전 실험 1단계 — maxContextTokens × extraSummarizationRatio 격자.
 *
 * 질문: max context는 캐싱 효율을 고정 헤드 비율(H/M)로만 바꾸는가, 아니면
 * 트림·hypa 발동률(듀티 사이클 k = M·r/Δ)을 통해 레짐 자체를 바꾸는가.
 * 격자·블록 크기·턴 수는 결과를 보기 전에 확정한 사전값이다(2026-07-26
 * 블라인드 3자 설계 합성). hypa 동역학은 RisuAI hypav3.ts 계약을 따른다:
 * currentTokens > maxContextTokens에서 발동, maxContextTokens × (1 − ratio)까지
 * 오래된 채팅을 요약 블록으로 치환. 요약 블록은 발동 사이에는 불변이다(on-fire).
 */

export type ContextRotationArm = 'core' | 'isotropic';
export type ContextRotationMemoryMode = 'hypa' | 'trim-only';

export interface ContextRotationCell {
  arm: ContextRotationArm;
  blockScale: number;
  extraSummarizationRatio: number;
  id: string;
  maxContextTokens: number;
  memoryMode: ContextRotationMemoryMode;
}

export interface ContextRotationScenario extends SimulationScenario {
  cell: ContextRotationCell;
  firingRequestIndexes: readonly number[];
  headMessageCount: number;
  quietTurnCapacity: number;
  // 요청 i와 i+1이 공유하는 선두 메시지 수. 마지막 요청은 0으로 둔다.
  survivingPrefixMessageCounts: readonly number[];
  warmupRequestCount: number;
}

export interface InfeasibleContextRotationCell {
  extraSummarizationRatio: number;
  maxContextTokens: number;
  reason: string;
}

export const CORE_MAX_CONTEXT_TOKENS = [32_000, 70_000, 100_000, 150_000, 220_000] as const;
export const CORE_EXTRA_SUMMARIZATION_RATIOS = [0, 0.05, 0.1, 0.2, 0.35, 0.5] as const;
export const ISOTROPIC_EXTRA_SUMMARIZATION_RATIOS = [0, 0.1] as const;

// 첫 마킹·admission 학습비가 정상 구간 평균을 오염시키지 않도록 폐기하는 구간.
export const WARMUP_REQUEST_COUNT = 5;

// 등방 대조군의 기준 크기. blockScale = maxContextTokens / HUB로 모든 블록을
// 함께 키워 H/M·τ/M·Δ/M을 셀 전체에서 동일하게 만든다. 이 arm에서 효율 차이가
// 나면 절대 임계(1024 최소 프리픽스, 16,384 게이트, window 50)가 개입한 것이다.
const HUB_MAX_CONTEXT_TOKENS = 100_000;

// 고정 헤드 H ≈ 12k, 후행 고정 τ ≈ 8k, 턴당 채팅 Δ ≈ 1k (허브 기준).
// τ는 공통 서픽스라 캐시 불가 — 손실률 τ/M이 M 효과의 방향을 가르는 항이다.
const HUB_BLOCK_TOKENS = {
  card: 6_000,
  chatAssistant: 800,
  chatUser: 200,
  currentInput: 250,
  format: 250,
  mainPrompt: 3_000,
  persona: 1_000,
  postHistory: 2_000,
  staticLore: 2_000,
  status: 5_500,
} as const;

type BlockTokenSizes = { [BlockName in keyof typeof HUB_BLOCK_TOKENS]: number };

// 요약 출력은 치환 원문 대비 고정 압축비. 요약 크기 자체의 효과는 비율 효과와
// 혼동되지 않도록 격자에서 고정한다(후속 프로브에서 분리).
const SUMMARY_COMPRESSION_RATIO = 0.12;

// 실제 hypaV3는 선택 단계가 주입 블록을 memoryTokensRatio(기본 0.2) 할당 안으로
// 자른다. 캡이 없으면 요약이 무한히 자라 채팅 최소 유지분과 충돌한다.
const MEMORY_TOKENS_RATIO = 0.2;

// wire prompt의 role/파트 구분자/message-end 프레이밍 근사치.
const MESSAGE_FRAMING_TOKENS = 8;

// 실제 hypaV3가 queryChatCount만큼의 최근 채팅을 요약 대상에서 제외하는 것의 대응물.
const MINIMUM_RETAINED_CHAT_PAIRS = 5;

const BASE_TURN_COUNT = 80;
const EXTENDED_TURN_COUNT = 200;
const REQUEST_INTERVAL_MINUTES = 3;

function scaleBlockTokens(blockScale: number): BlockTokenSizes {
  return {
    card: Math.round(HUB_BLOCK_TOKENS.card * blockScale),
    chatAssistant: Math.round(HUB_BLOCK_TOKENS.chatAssistant * blockScale),
    chatUser: Math.round(HUB_BLOCK_TOKENS.chatUser * blockScale),
    currentInput: Math.round(HUB_BLOCK_TOKENS.currentInput * blockScale),
    format: Math.round(HUB_BLOCK_TOKENS.format * blockScale),
    mainPrompt: Math.round(HUB_BLOCK_TOKENS.mainPrompt * blockScale),
    persona: Math.round(HUB_BLOCK_TOKENS.persona * blockScale),
    postHistory: Math.round(HUB_BLOCK_TOKENS.postHistory * blockScale),
    staticLore: Math.round(HUB_BLOCK_TOKENS.staticLore * blockScale),
    status: Math.round(HUB_BLOCK_TOKENS.status * blockScale),
  };
}

function makeText(label: string, tokens: number): string {
  const sentence = `[${label}] Context rotation benchmark prose keeps deterministic corridor logs, shelf counts, and numbered weather notes. `;
  const characters = Math.max(8, Math.round(tokens * 4));
  return sentence.repeat(Math.ceil(characters / sentence.length)).slice(0, characters);
}

function makeMessage(role: LlmMessage['role'], label: string, tokens: number): LlmMessage {
  return { role, content: [{ type: 'text', text: makeText(label, tokens) }] };
}

function textTokens(message: LlmMessage): number {
  return message.content.reduce(
    (total, part) => total + (part.type === 'text' ? Math.ceil(part.text.length / 4) : 0),
    0,
  );
}

function estimatedTokens(message: LlmMessage): number {
  return textTokens(message) + MESSAGE_FRAMING_TOKENS;
}

// 상태 블록의 매턴 미세 변동(13-manual-summary의 실측 계약과 같은 2자 치환).
// 누적 적용이라 인접 요청 간 정확히 한 지점만 달라지고 길이는 보존된다.
function mutateTextOnce(text: string, mutation: number): string {
  const offset = (mutation * 7_919) % (text.length - 2);
  return `${text.slice(0, offset)}${String(mutation % 100).padStart(2, '0')}${text.slice(offset + 2)}`;
}

function formatRatioForId(ratio: number): string {
  return String(Math.round(ratio * 100)).padStart(3, '0');
}

function formatTokensForId(tokens: number): string {
  return `${Math.round(tokens / 1_000)}k`;
}

export function createContextRotationCell(options: {
  arm: ContextRotationArm;
  extraSummarizationRatio: number;
  maxContextTokens: number;
  memoryMode: ContextRotationMemoryMode;
}): ContextRotationCell {
  const extraSummarizationRatio =
    options.memoryMode === 'trim-only' ? 0 : options.extraSummarizationRatio;
  const ratioTag =
    options.memoryMode === 'trim-only' ? 'trim' : `r${formatRatioForId(extraSummarizationRatio)}`;
  return {
    arm: options.arm,
    blockScale:
      options.arm === 'isotropic' ? options.maxContextTokens / HUB_MAX_CONTEXT_TOKENS : 1,
    extraSummarizationRatio,
    id: `crx-${options.arm === 'isotropic' ? 'iso' : 'core'}-m${formatTokensForId(options.maxContextTokens)}-${ratioTag}`,
    maxContextTokens: options.maxContextTokens,
    memoryMode: options.memoryMode,
  };
}

function cellInfeasibilityReason(cell: ContextRotationCell): string | null {
  const blocks = scaleBlockTokens(cell.blockScale);
  const targetTokens = cell.maxContextTokens * (1 - cell.extraSummarizationRatio);
  const headTokens =
    blocks.mainPrompt + blocks.card + blocks.persona + blocks.staticLore + 4 * MESSAGE_FRAMING_TOKENS;
  const tailTokens =
    blocks.postHistory + blocks.currentInput + blocks.format + blocks.status +
    4 * MESSAGE_FRAMING_TOKENS;
  const pairTokens = blocks.chatUser + blocks.chatAssistant + 2 * MESSAGE_FRAMING_TOKENS;
  // 정상 상태 최악 지점: 요약이 memoryTokensRatio 캡까지 자란 뒤에도 최소
  // 채팅 유지분을 남기고 목표 토큰에 도달할 수 있어야 한다.
  const maximumSummaryTokens =
    cell.memoryMode === 'hypa'
      ? Math.round(cell.maxContextTokens * MEMORY_TOKENS_RATIO) + MESSAGE_FRAMING_TOKENS
      : 0;
  const floorTokens =
    headTokens + tailTokens + MINIMUM_RETAINED_CHAT_PAIRS * pairTokens + maximumSummaryTokens;
  if (targetTokens < floorTokens) {
    return `요약 목표 ${Math.round(targetTokens).toLocaleString()}tok이 최소 구성 ${floorTokens.toLocaleString()}tok보다 작다`;
  }
  return null;
}

export function createContextRotationScenario(cell: ContextRotationCell): ContextRotationScenario {
  const infeasibleReason = cellInfeasibilityReason(cell);
  if (infeasibleReason !== null) {
    throw new RangeError(`Context rotation cell ${cell.id} is infeasible: ${infeasibleReason}`);
  }

  const blocks = scaleBlockTokens(cell.blockScale);
  const id = cell.id;
  const headMessages: readonly LlmMessage[] = [
    makeMessage('system', `${id}-main-prompt`, blocks.mainPrompt),
    makeMessage('system', `${id}-card`, blocks.card),
    makeMessage('user', `${id}-persona`, blocks.persona),
    makeMessage('system', `${id}-static-lore`, blocks.staticLore),
  ];
  const postHistoryMessage = makeMessage('user', `${id}-post-history`, blocks.postHistory);
  const formatMessage = makeMessage('user', `${id}-format`, blocks.format);
  const statusBaseText = makeText(`${id}-status`, blocks.status);

  const headTokens = headMessages.reduce((total, message) => total + estimatedTokens(message), 0);
  const tailTokens =
    estimatedTokens(postHistoryMessage) +
    estimatedTokens(formatMessage) +
    (blocks.currentInput + MESSAGE_FRAMING_TOKENS) +
    (Math.ceil(statusBaseText.length / 4) + MESSAGE_FRAMING_TOKENS);

  const chatPairTextTokens = blocks.chatUser + blocks.chatAssistant;
  const pairEstimatedTokens = chatPairTextTokens + 2 * MESSAGE_FRAMING_TOKENS;
  const targetTokens =
    cell.memoryMode === 'hypa'
      ? cell.maxContextTokens * (1 - cell.extraSummarizationRatio)
      : cell.maxContextTokens;

  const history: LlmMessage[] = [];
  let historyTokens = 0;
  let summaryPresent = false;
  let summarizedSourceTextTokens = 0;
  let summaryTextTokens = 0;
  let summaryVersion = 0;
  let summaryMessage: LlmMessage | null = null;
  let turn = 0;

  const pushChatUser = (): void => {
    turn += 1;
    const message = makeMessage('user', `${id}-user-t${turn}`, blocks.chatUser);
    history.push(message);
    historyTokens += estimatedTokens(message);
  };
  const pushChatAssistant = (): void => {
    const message = makeMessage('assistant', `${id}-assistant-t${turn}`, blocks.chatAssistant);
    history.push(message);
    historyTokens += estimatedTokens(message);
  };
  const totalTokens = (): number =>
    headTokens +
    (summaryPresent ? summaryTextTokens + MESSAGE_FRAMING_TOKENS : 0) +
    historyTokens +
    tailTokens;
  const retainedCompletePairs = (): number => Math.floor(history.length / 2);
  const removeOldestChatPair = (): number => {
    const removedUser = history[0];
    const removedAssistant = history[1];
    if (removedUser?.role !== 'user' || removedAssistant?.role !== 'assistant') {
      throw new Error(`Context rotation history for ${id} must start with a complete chat pair.`);
    }
    history.splice(0, 2);
    historyTokens -= estimatedTokens(removedUser) + estimatedTokens(removedAssistant);
    return textTokens(removedUser) + textTokens(removedAssistant);
  };

  // 워밍 스타트: 점유율을 M − 2Δ 근처까지 채워 첫 발동이 1~2요청 안에 오게 한다.
  // 콜드 스타트(성장 구간)는 이 실험의 대상이 아니라 별도 arm으로 남긴다.
  while (totalTokens() + 2 * pairEstimatedTokens <= cell.maxContextTokens) {
    pushChatUser();
    pushChatAssistant();
  }

  const quietTurnCapacity =
    cell.memoryMode === 'hypa'
      ? Math.floor((cell.maxContextTokens * cell.extraSummarizationRatio) / chatPairTextTokens)
      : 0;
  // 정상 구간에 완전한 듀티 사이클 3회 이상이 담기도록 턴 수를 사전 산정한다.
  const turnCount =
    WARMUP_REQUEST_COUNT + 3 * (quietTurnCapacity + 1) > BASE_TURN_COUNT
      ? EXTENDED_TURN_COUNT
      : BASE_TURN_COUNT;

  const firingRequestIndexes: number[] = [];
  const requests: ScenarioRequest[] = [];
  let statusText = statusBaseText;

  for (let requestIndex = 0; requestIndex < turnCount; requestIndex += 1) {
    pushChatUser();

    if (totalTokens() > cell.maxContextTokens) {
      if (cell.memoryMode === 'hypa') {
        firingRequestIndexes.push(requestIndex);
      }
      while (totalTokens() > targetTokens) {
        if (retainedCompletePairs() <= MINIMUM_RETAINED_CHAT_PAIRS) {
          throw new Error(
            `Context rotation cell ${id} cannot reach target tokens without dropping below ` +
              `${MINIMUM_RETAINED_CHAT_PAIRS} retained chat pairs.`,
          );
        }
        const removedTextTokens = removeOldestChatPair();
        if (cell.memoryMode === 'hypa') {
          summaryPresent = true;
          summarizedSourceTextTokens += removedTextTokens;
          summaryTextTokens = Math.min(
            Math.round(summarizedSourceTextTokens * SUMMARY_COMPRESSION_RATIO),
            Math.round(cell.maxContextTokens * MEMORY_TOKENS_RATIO),
          );
        }
      }
      if (cell.memoryMode === 'hypa') {
        summaryVersion += 1;
        summaryMessage = makeMessage('system', `${id}-summary-v${summaryVersion}`, summaryTextTokens);
      }
    }

    requests.push({
      elapsedMinutes: requestIndex === 0 ? 0 : REQUEST_INTERVAL_MINUTES,
      messages: [
        ...headMessages,
        ...(summaryMessage === null ? [] : [summaryMessage]),
        ...history,
        postHistoryMessage,
        makeMessage('user', `${id}-input-${requestIndex + 1}`, blocks.currentInput),
        formatMessage,
        { role: 'user', content: [{ type: 'text', text: statusText }] },
      ],
    });

    statusText = mutateTextOnce(statusText, requestIndex + 1);
    pushChatAssistant();
  }

  return {
    cell,
    firingRequestIndexes,
    headMessageCount: headMessages.length,
    id,
    label: `컨텍스트 회전 ${formatTokensForId(cell.maxContextTokens)} ${
      cell.memoryMode === 'trim-only' ? 'trim' : `r=${cell.extraSummarizationRatio}`
    } (${cell.arm})`,
    quietTurnCapacity,
    requests,
    survivingPrefixMessageCounts: computeSurvivingPrefixMessageCounts(requests),
    warmupRequestCount: WARMUP_REQUEST_COUNT,
  };
}

function messagesEqual(left: LlmMessage, right: LlmMessage): boolean {
  if (left === right) return true;
  if (left.role !== right.role || left.content.length !== right.content.length) return false;
  return left.content.every((part, partIndex) => {
    const other = right.content[partIndex];
    return part.type === 'text' && other.type === 'text' && part.text === other.text;
  });
}

function computeSurvivingPrefixMessageCounts(requests: readonly ScenarioRequest[]): number[] {
  return requests.map((request, requestIndex) => {
    const nextRequest = requests[requestIndex + 1];
    if (nextRequest === undefined) return 0;
    const maximumCount = Math.min(request.messages.length, nextRequest.messages.length);
    let count = 0;
    while (
      count < maximumCount &&
      messagesEqual(request.messages[count], nextRequest.messages[count])
    ) {
      count += 1;
    }
    return count;
  });
}

export function createCoreContextRotationScenarios(): readonly ContextRotationScenario[] {
  const scenarios: ContextRotationScenario[] = [];
  CORE_MAX_CONTEXT_TOKENS.forEach((maxContextTokens) => {
    scenarios.push(
      createContextRotationScenario(
        createContextRotationCell({
          arm: 'core',
          extraSummarizationRatio: 0,
          maxContextTokens,
          memoryMode: 'trim-only',
        }),
      ),
    );
    CORE_EXTRA_SUMMARIZATION_RATIOS.forEach((extraSummarizationRatio) => {
      const cell = createContextRotationCell({
        arm: 'core',
        extraSummarizationRatio,
        maxContextTokens,
        memoryMode: 'hypa',
      });
      if (cellInfeasibilityReason(cell) === null) {
        scenarios.push(createContextRotationScenario(cell));
      }
    });
  });
  return scenarios;
}

// 설정 불가 셀은 결측이 아니라 "그 컨텍스트에서는 그 비율을 쓸 수 없다"는 결과다.
export function listInfeasibleCoreCells(): readonly InfeasibleContextRotationCell[] {
  const infeasibleCells: InfeasibleContextRotationCell[] = [];
  CORE_MAX_CONTEXT_TOKENS.forEach((maxContextTokens) => {
    CORE_EXTRA_SUMMARIZATION_RATIOS.forEach((extraSummarizationRatio) => {
      const reason = cellInfeasibilityReason(
        createContextRotationCell({
          arm: 'core',
          extraSummarizationRatio,
          maxContextTokens,
          memoryMode: 'hypa',
        }),
      );
      if (reason !== null) {
        infeasibleCells.push({ extraSummarizationRatio, maxContextTokens, reason });
      }
    });
  });
  return infeasibleCells;
}

export function createIsotropicContextRotationScenarios(): readonly ContextRotationScenario[] {
  return CORE_MAX_CONTEXT_TOKENS.flatMap((maxContextTokens) =>
    ISOTROPIC_EXTRA_SUMMARIZATION_RATIOS.map((extraSummarizationRatio) =>
      createContextRotationScenario(
        createContextRotationCell({
          arm: 'isotropic',
          extraSummarizationRatio,
          maxContextTokens,
          memoryMode: 'hypa',
        }),
      ),
    ),
  );
}
