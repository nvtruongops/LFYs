import { z } from 'zod';

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_ORIGIN: z.url(),
  DATABASE_URL: z.url(),
  BETTER_AUTH_URL: z.url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  AI_PROVIDER_API_KEY: z.string().optional(),
  SOURCE_SEARCH_API_KEY: z.string().optional()
});

export function parseEnvironment(value: NodeJS.ProcessEnv) {
  return environmentSchema.parse(value);
}

export const env = parseEnvironment(process.env);
