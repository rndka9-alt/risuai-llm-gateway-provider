import type { LlmMessage } from 'llm-io';
import type { SimulationScenario } from '../scenario-contract';
import { makeBlock, makeMessage } from './fixture-builders';

interface RealisticScaleProfile {
  contextPaddingMessageIndex: number | 'penultimate';
  contextPaddingTokens: number;
  responseTokenSizes: readonly number[];
}

const DEFAULT_RESPONSE_TOKEN_SIZES = [3_000, 6_000, 12_000];

// 원본 메시지의 동일/변동 관계와 인덱스는 유지한 채 텍스트 크기만 확장한다.
// 그래야 각 scenario가 검증하던 diff topology를 현실 토큰 규모에서도 재사용할 수 있다.
const REALISTIC_SCALE_PROFILES = new Map<string, RealisticScaleProfile>([
  ['01-append', profile(79_000)],
  ['02-cbs-trap', profile(78_500, 1)],
  ['03-reverse-depth', profile(78_000)],
  ['04-reroll', profile(50_000, 0, [32_000])],
  ['05-lore-toggle', profile(80_000)],
  ['06-context-trim', profile(78_000)],
  ['07-hypa-summary', profile(78_000)],
  ['08-lua-post-edit', profile(66_000, 0, [20_000, 32_000, 12_000])],
  ['09-room-switch', profile(80_000)],
  ['10-ttl-gap', profile(80_000)],
  ['11-churn-then-stable', profile(55_000)],
  ['12-churn-oscillating', profile(78_000)],
  ['13-manual-summary-additive-floor-80k', profile(62_000, 0, [3_000])],
  ['13-manual-summary-additive-typical-110k', profile(0, 0, [3_000])],
  ['13-manual-summary-additive-ceiling-150k', profile(0, 0, [3_000])],
  ['13-manual-summary-additive-typical-110k-mixed', profile(0, 0, [3_000])],
  ['13-manual-summary-additive-hist-2t', profile(51_000)],
  ['13-manual-summary-additive-hist-32t', profile(0, 0, [3_000])],
  ['14-trim-saturation', profile(0, 0, [3_000, 6_000])],
  ['15-multi-room-roundrobin', profile(50_000, 1)],
  ['16-group-speaker-rotation', profile(50_000, 1)],
  ['17-mid-history-edits', profile(50_000)],
  ['18-suppressed-frontier-branch-boundary', profile(50_000, 'penultimate')],
  ['19-large-stable-prefix-admission', profile(60_000)],
  ['20-large-prefix-invalidated-after-admission', profile(60_000)],
  ['21-content-addressed-roundrobin', profile(50_000)],
  ['22-cross-churn-eviction', profile(35_000)],
]);

function profile(
  contextPaddingTokens: number,
  contextPaddingMessageIndex: number | 'penultimate' = 0,
  responseTokenSizes: readonly number[] = DEFAULT_RESPONSE_TOKEN_SIZES,
): RealisticScaleProfile {
  return { contextPaddingMessageIndex, contextPaddingTokens, responseTokenSizes };
}

function textOfFixtureMessage(message: LlmMessage): string {
  if (message.content.length !== 1) {
    throw new Error('Golden fixture messages must contain exactly one content part.');
  }
  const part = message.content[0];
  if (part === undefined || part.type !== 'text') {
    throw new Error('Golden fixture messages must contain one text part.');
  }
  return part.text;
}

function resizeFixtureMessage(
  message: LlmMessage,
  targetTokens: number,
  paddingLabel: string,
): LlmMessage {
  const text = textOfFixtureMessage(message);
  const targetCharacters = targetTokens * 4;
  if (text.length >= targetCharacters) return message;
  return makeMessage(
    message.role,
    `${text}${makeBlock(paddingLabel, targetCharacters - text.length)}`,
  );
}

function appendFixturePadding(
  message: LlmMessage,
  paddingTokens: number,
  paddingLabel: string,
): LlmMessage {
  if (paddingTokens === 0) return message;
  return makeMessage(
    message.role,
    `${textOfFixtureMessage(message)}${makeBlock(paddingLabel, paddingTokens * 4)}`,
  );
}

export function scaleCanonicalScenario(scenario: SimulationScenario): SimulationScenario {
  const scaleProfile = REALISTIC_SCALE_PROFILES.get(scenario.id);
  if (scaleProfile === undefined) {
    throw new Error(`Missing realistic scale profile for ${scenario.id}.`);
  }
  if (scaleProfile.responseTokenSizes.length === 0) {
    throw new Error(`Response token sizes must not be empty for ${scenario.id}.`);
  }

  const responseTargets = new Map<string, number>();
  let nextResponseTargetIndex = 0;
  scenario.requests.forEach((scenarioRequest) => {
    scenarioRequest.messages.forEach((message) => {
      if (message.role !== 'assistant') return;
      const text = textOfFixtureMessage(message);
      if (responseTargets.has(text)) return;
      const target = scaleProfile.responseTokenSizes[nextResponseTargetIndex];
      if (target === undefined) {
        throw new Error(`Missing response target for ${scenario.id}.`);
      }
      responseTargets.set(text, target);
      nextResponseTargetIndex =
        (nextResponseTargetIndex + 1) % scaleProfile.responseTokenSizes.length;
    });
  });

  return {
    ...scenario,
    requests: scenario.requests.map((scenarioRequest) => {
      const contextPaddingMessageIndex =
        scaleProfile.contextPaddingMessageIndex === 'penultimate'
          ? scenarioRequest.messages.length - 2
          : scaleProfile.contextPaddingMessageIndex;
      if (
        contextPaddingMessageIndex < 0 ||
        contextPaddingMessageIndex >= scenarioRequest.messages.length
      ) {
        throw new RangeError(`Context padding index is outside ${scenario.id}.`);
      }
      return {
        ...scenarioRequest,
        messages: scenarioRequest.messages.map((message, messageIndex) => {
          let scaledMessage = message;
          if (message.role === 'assistant') {
            const text = textOfFixtureMessage(message);
            const target = responseTargets.get(text);
            if (target === undefined) {
              throw new Error(`Missing response target for ${scenario.id}.`);
            }
            scaledMessage = resizeFixtureMessage(
              message,
              target,
              `${scenario.id}-response-${target}`,
            );
          }
          return messageIndex === contextPaddingMessageIndex
            ? appendFixturePadding(
                scaledMessage,
                scaleProfile.contextPaddingTokens,
                `${scenario.id}-context-padding`,
              )
            : scaledMessage;
        }),
      };
    }),
  };
}
