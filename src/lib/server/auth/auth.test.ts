import { describe, expect, it } from 'vitest';
import { auth } from './index';

describe('Better Auth handler', () => {
  it('returns no session for requests without a session cookie', async () => {
    const response = await auth.handler(new Request('http://localhost:5173/api/auth/get-session'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toBeNull();
  });
});
