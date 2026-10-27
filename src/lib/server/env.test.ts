import { describe, expect, it } from 'vitest';
import { parseEnvironment } from './env';

describe('parseEnvironment', () => {
  it('defaults the runtime environment to development', () => {
    expect(
      parseEnvironment({
        APP_ORIGIN: 'http://localhost:5173',
        DATABASE_URL: 'postgresql://lfys:lfys@localhost:5432/lfys',
        BETTER_AUTH_URL: 'http://localhost:5173',
        BETTER_AUTH_SECRET: 'a'.repeat(32)
      }).NODE_ENV
    ).toBe('development');
  });

  it('rejects an auth secret shorter than 32 characters', () => {
    expect(() =>
      parseEnvironment({
        APP_ORIGIN: 'http://localhost:5173',
        DATABASE_URL: 'postgresql://lfys:lfys@localhost:5432/lfys',
        BETTER_AUTH_URL: 'http://localhost:5173',
        BETTER_AUTH_SECRET: 'too-short'
      })
    ).toThrow();
  });

  it('keeps the local model provider disabled when its key is blank', () => {
    const parsed = parseEnvironment({
      APP_ORIGIN: 'http://localhost:5173',
      DATABASE_URL: 'postgresql://lfys:lfys@localhost:5432/lfys',
      BETTER_AUTH_URL: 'http://localhost:5173',
      BETTER_AUTH_SECRET: 'a'.repeat(32),
      AI_PROVIDER_API_KEY: '',
      AI_PROVIDER_BASE_URL: 'http://localhost:20128/v1',
      AI_PROVIDER_MODEL_ID: 'cx/gpt-6-luna'
    });

    expect(parsed.AI_PROVIDER_API_KEY).toBeUndefined();
    expect(parsed.AI_PROVIDER_BASE_URL).toBe('http://localhost:20128/v1');
    expect(parsed.AI_PROVIDER_MODEL_ID).toBe('cx/gpt-6-luna');
  });

  it('requires provider URL and model when a key is set', () => {
    expect(() => parseEnvironment({
      APP_ORIGIN: 'http://localhost:5173',
      DATABASE_URL: 'postgresql://lfys:lfys@localhost:5432/lfys',
      BETTER_AUTH_URL: 'http://localhost:5173',
      BETTER_AUTH_SECRET: 'a'.repeat(32),
      AI_PROVIDER_API_KEY: 'unit-test-key'
    })).toThrow();
  });
});
