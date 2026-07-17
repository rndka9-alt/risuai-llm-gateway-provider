import { z } from 'zod';
import {
  API_KEY_ARGUMENT,
  FLAGS_ARGUMENT,
  MODEL_ARGUMENT,
  PROMPT_CACHE_MODE_ARGUMENT,
  REASONING_EFFORT_ARGUMENT,
  SERVICE_TIER_ARGUMENT,
  STREAMING_MODE_ARGUMENT,
  VERBOSITY_ARGUMENT,
} from '../constants';

export const configSchema = z.object({
  [API_KEY_ARGUMENT]: z.string().default(''),
  [MODEL_ARGUMENT]: z.string().default(''),
  [PROMPT_CACHE_MODE_ARGUMENT]: z.string().default(''),
  [SERVICE_TIER_ARGUMENT]: z.string().default(''),
  [REASONING_EFFORT_ARGUMENT]: z.string().default(''),
  [VERBOSITY_ARGUMENT]: z.string().default(''),
  [STREAMING_MODE_ARGUMENT]: z.string().default(''),
  [FLAGS_ARGUMENT]: z.string().default(''),
});

export type Config = z.infer<typeof configSchema>;
export type ConfigUpdate = Partial<Config>;

export function createDefaultConfig(): Config {
  return configSchema.parse({});
}
