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
});
