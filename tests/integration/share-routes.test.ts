import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { POST } from '../../src/routes/api/learning/[journeyId]/share/+server';
import { db } from '../../src/lib/server/db';
import { user } from '../../src/lib/server/db/schema/auth';
import { learningJourney, learningSession } from '../../src/lib/server/db/schema/personal-learning';

const owners: string[] = [];

async function createOwner() {
  const id = crypto.randomUUID();
  owners.push(id);
  await db.insert(user).values({ id, name: 'Share route test', email: `lfys-${id}@example.test`, emailVerified: false });
  return id;
}

afterEach(async () => {
  for (const id of owners.splice(0)) await db.delete(user).where(eq(user.id, id));
});

describe('share API', () => {
  it('requires the journey owner and returns a one-time share token', async () => {
    const ownerId = await createOwner();
    const otherOwnerId = await createOwner();
    const [journey] = await db.insert(learningJourney).values({
      ownerUserId: ownerId,
      conversationId: null,
      goal: 'Shareable goal',
      studyDays: 1,
      dailyMinutes: 30,
      status: 'ready'
    }).returning({ id: learningJourney.id });
    await db.insert(learningSession).values({
      journeyId: journey.id,
      sessionIndex: 1,
      status: 'ready',
      title: 'Lesson',
      lesson: 'Verified lesson',
      activityMinutes: 20,
      sourceManifest: [{ url: 'https://example.org/lesson', name: 'Example', retrievedAt: '2026-10-27T12:00:00.000Z', relationship: 'Explains the lesson' }],
      idempotencyKey: `${journey.id}:session:1`
    });

    const makeRequest = (userId: string | null) => POST({
      request: new Request(`http://localhost/api/learning/${journey.id}/share`, { method: 'POST' }),
      params: { journeyId: journey.id },
      locals: { user: userId ? { id: userId, name: 'Test user' } : null }
    } as never);

    const statusOf = async (promise: ReturnType<typeof makeRequest>) => {
      try {
        return (await promise).status;
      } catch (error) {
        return (error as { status: number }).status;
      }
    };

    expect(await statusOf(makeRequest(null))).toBe(401);
    expect(await statusOf(makeRequest(otherOwnerId))).toBe(404);
    const response = await makeRequest(ownerId);
    expect(response.status).toBe(201);
    const result = await response.json();
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.expiresAt).toBeDefined();
  });
});
