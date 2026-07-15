import { Llm, LlmHttpError, LLMGatewayProvider, OpenAIChatCompletionsFormat } from 'llm-io';
import { toLlmMessages } from './convert';
import { openSettings } from './settings';

declare const __VERSION__: string;

const PROVIDER_NAME = 'LLM Gateway';

async function readArgument(key: string): Promise<string | undefined> {
  const value = await risuai.getArgument(key);
  if (typeof value !== 'string') return undefined;

  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function toFailureContent(error: unknown): string {
  if (error instanceof LlmHttpError) {
    return `LLM Gateway 요청 실패 (HTTP ${error.status})\n${error.body}`;
  }
  if (error instanceof Error) {
    return `LLM Gateway 요청 실패: ${error.message}`;
  }
  return `LLM Gateway 요청 실패: ${String(error)}`;
}

async function requestLLMGateway(
  args: ProviderArguments,
  abortSignal?: AbortSignal,
): Promise<ProviderResponse> {
  const apiKey = await readArgument('api_key');
  const model = await readArgument('model');

  if (apiKey === undefined || model === undefined) {
    return {
      success: false,
      content: '플러그인 설정에서 api_key와 model 인자를 입력해주세요.',
    };
  }

  const baseUrl = await readArgument('base_url');

  const llm = new Llm({
    format: new OpenAIChatCompletionsFormat({ model }),
    provider: new LLMGatewayProvider(baseUrl === undefined ? { apiKey } : { apiKey, baseUrl }),
    // 플러그인 iframe은 CSP(connect-src 'none')로 직접 fetch가 막혀 있어
    // RisuAI 브릿지를 경유한다.
    fetch: (url, init) => risuai.nativeFetch(url, init),
  });

  try {
    const output = await llm.generate({
      messages: toLlmMessages(args.prompt_chat),
      options: {
        maxTokens: args.max_tokens,
        temperature: args.temperature,
        topP: args.top_p,
      },
      signal: abortSignal,
    });

    return { success: true, content: output.message.text };
  } catch (error) {
    return { success: false, content: toFailureContent(error) };
  }
}

async function main(): Promise<void> {
  await risuai.addProvider(PROVIDER_NAME, requestLLMGateway);
  const settingsRegistration = await risuai.registerSetting(
    'LLM Gateway',
    openSettings,
    '&#x1f511;',
    'html',
    'llm-gateway-settings',
  );
  await risuai.onUnload(() => risuai.unregisterUIPart(settingsRegistration.id));
  console.log(`[llm-gateway-provider] v${__VERSION__} loaded`);
}

void main();
