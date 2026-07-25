import type { OpenAIChatCompletionsExtraBody } from 'llm-io';

export type Verbosity = Exclude<OpenAIChatCompletionsExtraBody['verbosity'], undefined>;

export const VERBOSITY_OPTIONS: readonly Verbosity[] = ['low', 'medium', 'high'];

export function resolveVerbosity(value: string | undefined): Verbosity | undefined {
  const trimmed = value?.trim();
  if (trimmed === 'low') return 'low';
  if (trimmed === 'medium') return 'medium';
  if (trimmed === 'high') return 'high';
  return undefined;
}
