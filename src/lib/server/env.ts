import { z } from 'zod';

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_ORIGIN: z.url(),
  DATABASE_URL: z.url(),
  BETTER_AUTH_URL: z.url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  AI_PROVIDER_API_KEY: z.preprocess(
    (value) => typeof value === 'string' && value.trim() === '' ? undefined : value,
    z.string().trim().min(1).optional()
  ),
  AI_PROVIDER_BASE_URL: z.url().optional(),
  AI_PROVIDER_MODEL_ID: z.string().trim().min(1).optional(),
  SOURCE_SEARCH_API_KEY: z.string().optional()
}).superRefine((value, context) => {
  if (value.AI_PROVIDER_API_KEY && (!value.AI_PROVIDER_BASE_URL || !value.AI_PROVIDER_MODEL_ID)) {
    context.addIssue({ code: 'custom', message: 'AI_PROVIDER_API_KEY requires AI_PROVIDER_BASE_URL and AI_PROVIDER_MODEL_ID' });
  }
});

export function parseEnvironment(value: NodeJS.ProcessEnv) {
  return environmentSchema.parse(value);
}

export const env = parseEnvironment(process.env);
