import { loadCacheAnchorBankSnapshot } from './cache';
import { FLAGS_ARGUMENT, initializeConfigOnStartup } from './config';
import {
  RISUAI_TIKTOKEN_O200_BASE_TOKENIZER,
  resolveConfigurableLlmFlagNames,
  resolveProviderLlmFlags,
} from './options';
import { requestLLMGateway } from './provider';
import { loadProviderRegistered, markProviderRegistered } from './provider-registered-state';
import { openSettings, type ProviderRegistrationSettings } from './settings';

declare const __VERSION__: string;

const PROVIDER_NAME = 'LLM Gateway';

async function main(): Promise<void> {
  // 상주 iframe의 부팅 구간에서 샤드 snapshot을 미리 채워 첫 메시지의 cold-load를 피한다.
  // 실패 시 snapshot이 발행되지 않아 요청 경로의 기존 lazy load가 다시 시도한다.
  void loadCacheAnchorBankSnapshot().catch((error) => {
    console.error('[llm-gateway-provider] cache anchor bank eager load failed; continuing', error);
  });
  // config 존재를 등록 이력 판별에 쓰므로 config 초기화(첫 부팅 시 생성)보다 먼저 읽는다.
  // 이번 세션 UI가 쓸 값을 여기서 확보하고, 등록을 마치면 true를 기록해
  // 다음 로드(새로고침)부터 설치 완료로 읽히게 한다.
  const providerRegistered = await loadProviderRegistered();
  const config = await initializeConfigOnStartup();
  const registrationSettings: ProviderRegistrationSettings = {
    flagNames: resolveConfigurableLlmFlagNames(config[FLAGS_ARGUMENT]),
  };
  await risuai.addProvider(
    PROVIDER_NAME,
    (providerArguments, abortSignal) => requestLLMGateway(providerArguments, abortSignal),
    {
      // RisuAI src/ts/tokenizer.ts가 custom provider의 o200k_base 문자열을 직접 소비한다.
      tokenizer: 'o200k_base',
      model: {
        name: PROVIDER_NAME,
        flags: resolveProviderLlmFlags(registrationSettings.flagNames),
        parameters: ['temperature', 'top_p', 'frequency_penalty', 'presence_penalty'],
        tokenizer: RISUAI_TIKTOKEN_O200_BASE_TOKENIZER,
      },
    },
  );
  if (!providerRegistered) {
    void markProviderRegistered();
  }
  const settingsRegistration = await risuai.registerSetting(
    'LLM Gateway',
    () => openSettings(registrationSettings, providerRegistered),
    '&#x1f511;',
    'html',
    'llm-gateway-settings',
  );
  await risuai.onUnload(() => risuai.unregisterUIPart(settingsRegistration.id));
  console.log(`[llm-gateway-provider] v${__VERSION__} loaded`);
}

void main();
