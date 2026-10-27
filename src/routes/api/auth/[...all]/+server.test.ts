import { describe, expect, it } from 'vitest';
import { GET, POST } from './+server';

describe('auth route', () => {
  it('handles session lookups without a cookie', async () => {
    const response = await GET({
      request: new Request('http://localhost:5173/api/auth/get-session')
    } as Parameters<typeof GET>[0]);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toBeNull();
  });

  it('routes auth mutations through Better Auth', async () => {
    const response = await POST({
      request: new Request('http://localhost:5173/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'invalid', password: 'invalid' })
      })
    } as Parameters<typeof POST>[0]);

    expect(response.status).not.toBe(404);
  });
});
