import type { LlmMessage } from 'llm-io';
import { markCacheBreakpoints } from '../../cache/breakpoint/mark-cache-breakpoints';
import { getPromptCacheKey } from '../../cache/mode/get-prompt-cache-key';
import { fingerprintMessage } from '../../cache/planner/fingerprint-message';
import type { CachePlan } from '../../cache/types';
import type { ReplayCachePolicy } from './policy';
import type { GoldenTrajectory, TrajectoryRequest } from './replay';

const FIXED_HEAD_INDEX = 0;
const ROTATING_BLOCK_INDEX = 1;
const FIXED_TAIL_INDEX = 2;
const REQUESTS_PER_TRAJECTORY = 36;

export interface MiddleBlockTrajectory extends GoldenTrajectory {
  fixedTailTokens: number;
  phaseCount: number | null;
  switchEveryTurns: number;
}

interface PhasePattern {
  id: string;
  label: string;
  phaseCount: number | null;
  switchEveryTurns: number;
}

const PHASE_PATTERNS: readonly PhasePattern[] = [
  {
    id: 'two-fast',
    label: '2상태 매요청 회전',
    phaseCount: 2,
    switchEveryTurns: 1,
  },
  {
    id: 'four-fast',
    label: '4상태 매요청 회전',
    phaseCount: 4,
    switchEveryTurns: 1,
  },
  {
    id: 'eight-fast',
    label: '8상태 매요청 회전',
    phaseCount: 8,
    switchEveryTurns: 1,
  },
  {
    id: 'sixteen-fast',
    label: '16상태 매요청 회전',
    phaseCount: 16,
    switchEveryTurns: 1,
  },
  {
    id: 'unique-fast',
    label: '매요청 새 상태',
    phaseCount: null,
    switchEveryTurns: 1,
  },
  {
    id: 'two-dwell',
    label: '2상태·상태당 3요청',
    phaseCount: 2,
    switchEveryTurns: 3,
  },
];

const FIXED_TAIL_TOKEN_SIZES = [1_000, 8_000, 24_000] as const;

function makeText(label: string, tokens: number): string {
  const sentence = `[${label}] Middle-block anchor simulation keeps deterministic prose for exact-prefix accounting. `;
  const characters = Math.max(8, Math.round(tokens * 4));
  return sentence.repeat(Math.ceil(characters / sentence.length)).slice(0, characters);
}

function makeMessage(role: LlmMessage['role'], label: string, tokens: number): LlmMessage {
  return { role, content: [{ type: 'text', text: makeText(label, tokens) }] };
}

function phaseOrdinalForTurn(turn: number, switchEveryTurns: number): number {
  return Math.floor((turn - 1) / switchEveryTurns);
}

function phaseIdentityForTurn(
  turn: number,
  phaseCount: number | null,
  switchEveryTurns: number,
): number {
  const phaseOrdinal = phaseOrdinalForTurn(turn, switchEveryTurns);
  return phaseCount === null ? phaseOrdinal : phaseOrdinal % phaseCount;
}

function createMiddleBlockTrajectory(
  pattern: PhasePattern,
  fixedTailTokens: number,
): MiddleBlockTrajectory {
  const id = `middle-${pattern.id}-tail-${fixedTailTokens}`;
  const fixedHead = makeMessage('system', `${id}-fixed-head`, 8_000);
  const fixedTail = makeMessage('system', `${id}-fixed-tail`, fixedTailTokens);
  const phases = new Map<number, LlmMessage>();
  const history: LlmMessage[] = [];
  const requests: TrajectoryRequest[] = [];

  for (let turn = 1; turn <= REQUESTS_PER_TRAJECTORY; turn += 1) {
    const phaseIdentity = phaseIdentityForTurn(turn, pattern.phaseCount, pattern.switchEveryTurns);
    let rotatingBlock = phases.get(phaseIdentity);
    if (rotatingBlock === undefined) {
      rotatingBlock = makeMessage('system', `${id}-phase-${phaseIdentity}`, 1_500);
      phases.set(phaseIdentity, rotatingBlock);
    }

    history.push(makeMessage('user', `${id}-user-${turn}`, 120 + (turn % 4) * 20));
    requests.push({
      elapsedMinutes: 2,
      messages: [fixedHead, rotatingBlock, fixedTail, ...history],
    });
    history.push(makeMessage('assistant', `${id}-assistant-${turn}`, 500 + (turn % 5) * 50));
  }

  return {
    fixedTailTokens,
    id,
    label: `${pattern.label}, 고정 B ${fixedTailTokens.toLocaleString()}tok`,
    phaseCount: pattern.phaseCount,
    requests,
    switchEveryTurns: pattern.switchEveryTurns,
  };
}

export function createMiddleBlockTrajectories(): readonly MiddleBlockTrajectory[] {
  return PHASE_PATTERNS.flatMap((pattern) =>
    FIXED_TAIL_TOKEN_SIZES.map((fixedTailTokens) =>
      createMiddleBlockTrajectory(pattern, fixedTailTokens),
    ),
  );
}

interface SemanticAnchorPolicyOptions {
  includeCurrentFrontier: boolean;
  includeFixedHead: boolean;
  includeFixedTail: boolean;
  includePreviousPhaseFrontier: boolean;
  name:
    | 'oracle-frontier'
    | 'oracle-phase'
    | 'oracle-phase-recall'
    | 'oracle-recurrence-admitted'
    | 'oracle-shield'
    | 'oracle-shield-frontier'
    | 'oracle-shield-phase'
    | 'oracle-shield-phase-recall'
    | 'oracle-ttl-recurrence-admitted'
    | 'oracle-wallclock-recurrence-admitted';
  // 생략 시 'rotating-message'(회전 블록 단독 hash). 'prefix-through-rotating'은
  // head 변경까지 identity에 포함해, prefix가 실제로 반복될 때만 재등장으로 본다
  // (unique-head류 over-admit 방지).
  phaseIdentity?: 'rotating-message' | 'prefix-through-rotating';
  recurrenceWindowMinutes?: number;
  recurrenceWindowRequests?: number;
  requirePhaseRecurrence: boolean;
}

function normalizeAnchorIndexes(anchorIndexes: readonly number[]): number[] {
  const normalized = [...new Set(anchorIndexes)].sort((left, right) => left - right);
  if (normalized.length > 4) {
    throw new RangeError('Middle-block oracle policy cannot emit more than four anchors.');
  }
  return normalized;
}

interface PhaseObservation {
  atMinute: number | null;
  requestIndex: number;
}

function createSemanticAnchorPolicy(options: SemanticAnchorPolicyOptions): ReplayCachePolicy {
  const markedFrontierByPhase = new Map<string, number>();
  const lastPhaseObservation = new Map<string, PhaseObservation>();
  let requestIndex = 0;

  return {
    name: options.name,
    async apply(messages, context) {
      if (messages.length <= FIXED_TAIL_INDEX) {
        throw new RangeError('Middle-block trajectory must contain head, phase, and tail blocks.');
      }
      if (options.recurrenceWindowMinutes !== undefined && context === undefined) {
        throw new Error('Wall-clock admission policy requires replay to pass atMinute context.');
      }
      const fingerprints = messages.map(fingerprintMessage);
      const rotatingFingerprint = fingerprints[ROTATING_BLOCK_INDEX];
      if (rotatingFingerprint === undefined) {
        throw new RangeError('Rotating block fingerprint must exist.');
      }
      const phaseKey =
        options.phaseIdentity === 'prefix-through-rotating'
          ? fingerprints
              .slice(0, ROTATING_BLOCK_INDEX + 1)
              .map((fingerprint) => `${fingerprint.role}:${fingerprint.hash}`)
              .join('␟')
          : `${rotatingFingerprint.role}:${rotatingFingerprint.hash}`;
      const currentFrontierIndex = messages.length - 1;
      const lastObservation = lastPhaseObservation.get(phaseKey);
      const withinRequestWindow =
        options.recurrenceWindowRequests === undefined ||
        (lastObservation !== undefined &&
          requestIndex - lastObservation.requestIndex <= options.recurrenceWindowRequests);
      const withinMinuteWindow =
        options.recurrenceWindowMinutes === undefined ||
        (lastObservation !== undefined &&
          lastObservation.atMinute !== null &&
          context !== undefined &&
          context.atMinute - lastObservation.atMinute <= options.recurrenceWindowMinutes);
      const phaseIsAdmitted =
        !options.requirePhaseRecurrence ||
        (lastObservation !== undefined && withinRequestWindow && withinMinuteWindow);
      const previousPhaseFrontierIndex = markedFrontierByPhase.get(phaseKey);
      const anchorIndexes: number[] = [];

      if (options.includeFixedHead) anchorIndexes.push(FIXED_HEAD_INDEX);
      if (options.includeFixedTail && phaseIsAdmitted) anchorIndexes.push(FIXED_TAIL_INDEX);
      if (
        options.includePreviousPhaseFrontier &&
        phaseIsAdmitted &&
        previousPhaseFrontierIndex !== undefined &&
        previousPhaseFrontierIndex < messages.length
      ) {
        anchorIndexes.push(previousPhaseFrontierIndex);
      }
      if (options.includeCurrentFrontier && phaseIsAdmitted) {
        anchorIndexes.push(currentFrontierIndex);
      }

      const normalizedAnchorIndexes = normalizeAnchorIndexes(anchorIndexes);
      const plan: CachePlan = {
        anchorIndexes: normalizedAnchorIndexes,
        markingAnchorIndexes: normalizedAnchorIndexes,
        nextState: {
          anchorAdmissions: [],
          anchorIndexes: normalizedAnchorIndexes,
          consecutiveEpochResets: 0,
          consecutiveFrontierDeaths: 0,
          fingerprints,
        },
      };
      const markedMessages = markCacheBreakpoints([...messages], plan);
      lastPhaseObservation.set(phaseKey, {
        atMinute: context === undefined ? null : context.atMinute,
        requestIndex,
      });
      if (options.includeCurrentFrontier && phaseIsAdmitted) {
        markedFrontierByPhase.set(phaseKey, currentFrontierIndex);
      }
      requestIndex += 1;

      return {
        anchorIndexes: normalizedAnchorIndexes,
        consecutiveEpochResets: 0,
        messages: markedMessages,
        promptCacheKey: getPromptCacheKey('explicit'),
      };
    },
  };
}

export interface MiddleBlockPolicyFactory {
  create: () => ReplayCachePolicy;
  name: ReplayCachePolicy['name'];
}

export const MIDDLE_BLOCK_POLICY_FACTORIES: readonly MiddleBlockPolicyFactory[] = [
  {
    create: () =>
      createSemanticAnchorPolicy({
        includeCurrentFrontier: false,
        includeFixedHead: true,
        includeFixedTail: false,
        includePreviousPhaseFrontier: false,
        name: 'oracle-shield',
        requirePhaseRecurrence: false,
      }),
    name: 'oracle-shield',
  },
  {
    create: () =>
      createSemanticAnchorPolicy({
        includeCurrentFrontier: false,
        includeFixedHead: false,
        includeFixedTail: true,
        includePreviousPhaseFrontier: false,
        name: 'oracle-phase',
        requirePhaseRecurrence: false,
      }),
    name: 'oracle-phase',
  },
  {
    create: () =>
      createSemanticAnchorPolicy({
        includeCurrentFrontier: false,
        includeFixedHead: true,
        includeFixedTail: true,
        includePreviousPhaseFrontier: false,
        name: 'oracle-shield-phase',
        requirePhaseRecurrence: false,
      }),
    name: 'oracle-shield-phase',
  },
  {
    create: () =>
      createSemanticAnchorPolicy({
        includeCurrentFrontier: true,
        includeFixedHead: false,
        includeFixedTail: false,
        includePreviousPhaseFrontier: false,
        name: 'oracle-frontier',
        requirePhaseRecurrence: false,
      }),
    name: 'oracle-frontier',
  },
  {
    create: () =>
      createSemanticAnchorPolicy({
        includeCurrentFrontier: true,
        includeFixedHead: true,
        includeFixedTail: false,
        includePreviousPhaseFrontier: false,
        name: 'oracle-shield-frontier',
        requirePhaseRecurrence: false,
      }),
    name: 'oracle-shield-frontier',
  },
  {
    create: () =>
      createSemanticAnchorPolicy({
        includeCurrentFrontier: true,
        includeFixedHead: false,
        includeFixedTail: true,
        includePreviousPhaseFrontier: true,
        name: 'oracle-phase-recall',
        requirePhaseRecurrence: false,
      }),
    name: 'oracle-phase-recall',
  },
  {
    create: () =>
      createSemanticAnchorPolicy({
        includeCurrentFrontier: true,
        includeFixedHead: true,
        includeFixedTail: true,
        includePreviousPhaseFrontier: true,
        name: 'oracle-shield-phase-recall',
        requirePhaseRecurrence: false,
      }),
    name: 'oracle-shield-phase-recall',
  },
  {
    create: () =>
      createSemanticAnchorPolicy({
        includeCurrentFrontier: true,
        includeFixedHead: true,
        includeFixedTail: true,
        includePreviousPhaseFrontier: true,
        name: 'oracle-recurrence-admitted',
        requirePhaseRecurrence: true,
      }),
    name: 'oracle-recurrence-admitted',
  },
  {
    create: () =>
      createSemanticAnchorPolicy({
        includeCurrentFrontier: true,
        includeFixedHead: true,
        includeFixedTail: true,
        includePreviousPhaseFrontier: true,
        name: 'oracle-ttl-recurrence-admitted',
        // 모든 실험 요청 간격이 2분이므로 14요청은 28분이다. 30분 경계
        // 자체는 서버 축출 타이밍에 민감하므로 안전측으로 포함하지 않는다.
        recurrenceWindowRequests: 14,
        requirePhaseRecurrence: true,
      }),
    name: 'oracle-ttl-recurrence-admitted',
  },
  {
    create: () =>
      createSemanticAnchorPolicy({
        includeCurrentFrontier: true,
        includeFixedHead: true,
        includeFixedTail: true,
        includePreviousPhaseFrontier: true,
        name: 'oracle-wallclock-recurrence-admitted',
        // 보완판: 창을 요청 수 proxy 대신 wall-clock으로 재서 세션 속도에
        // 자동 적응하고(slow/fast-clock 방어), identity에 head까지 포함해
        // prefix가 실제로 반복될 때만 admit한다(unique-head 방어).
        phaseIdentity: 'prefix-through-rotating',
        recurrenceWindowMinutes: 28,
        requirePhaseRecurrence: true,
      }),
    name: 'oracle-wallclock-recurrence-admitted',
  },
];
