import { describe, expect, it, vi } from 'vitest';
import { load } from './+page.server';

vi.mock('../../../lib/server/personal-learning', () => ({ getLearningStatus: vi.fn().mockResolvedValue([]) }));

describe('private learning route', () => {
  it.each([null, undefined])('redirects when the request has no authenticated user', async (user) => {
    await expect(load({ locals: { user } } as Parameters<typeof load>[0]))
      .rejects.toMatchObject({ status: 303, location: '/sign-in' });
  });

  it('returns private page data only for an authenticated user', async () => {
    await expect(load({ locals: { user: { id: 'owner-1', name: 'Learner' } } } as Parameters<typeof load>[0]))
      .resolves.toEqual({ learnerName: 'Learner', journeys: [] });
  });
});
