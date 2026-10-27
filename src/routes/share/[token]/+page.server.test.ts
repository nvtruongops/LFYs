import { describe, expect, it } from 'vitest';
import { load } from './+page.server';

describe('shared journey page', () => {
  it('rejects malformed share tokens as unavailable', async () => {
    await expect(load({ params: { token: 'not-a-token' } } as Parameters<typeof load>[0]))
      .rejects.toMatchObject({ status: 404 });
  });
});
