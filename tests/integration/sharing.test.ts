import { afterEach, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { db } from '../../src/lib/server/db';
import { user } from '../../src/lib/server/db/schema/auth';
import { learningChatTurn, learningForkLineage, learningJourney, learningSession, learningShare } from '../../src/lib/server/db/schema/personal-learning';
import { stopLearningQueue } from '../../src/lib/server/jobs';
import { acceptOffer, continueJourney, createAnsweredConversation, offerLearning } from '../../src/lib/server/personal-learning';
import { createShare, forkShare, readSharedSnapshot, revokeShare } from '../../src/lib/server/personal-learning/sharing';

const owners: string[] = [];

async function createOwner() {
  const id = crypto.randomUUID();
  owners.push(id);
  await db.insert(user).values({ id, name: 'Share test', email: `lfys-${id}@example.test`, emailVerified: false });
  return id;
}

afterEach(async () => {
  if (owners.length) {
    await db.delete(learningForkLineage).where(inArray(learningForkLineage.ownerUserId, owners));
    await db.delete(learningShare).where(inArray(learningShare.ownerUserId, owners));
  }
  for (const id of owners.splice(0)) await db.delete(user).where(eq(user.id, id));
  await stopLearningQueue();
});

describe('learning snapshots and forks', () => {
  it('shares only ready source-backed lessons and forks independent owner content', async () => {
    const ownerId = await createOwner();
    const viewerId = await createOwner();
    const conversation = await createAnsweredConversation({
      ownerId,
      question: 'Private question',
      answer: 'Private answer',
      goal: 'Source goal',
      language: 'en',
      priorKnowledge: 'Private context'
    });
    await offerLearning({ ownerId, conversationId: conversation.id });
    const accepted = await acceptOffer({ ownerId, conversationId: conversation.id, goal: 'Source goal', studyDays: 7, dailyMinutes: 60 });
    await db.update(learningJourney).set({ status: 'ready' }).where(eq(learningJourney.id, accepted.journeyId));
    await db.update(learningSession).set({
      status: 'ready',
      title: 'Battery basics',
      lesson: 'Public lesson text',
      activityMinutes: 45,
      sourceManifest: [{
        id: 'source-1',
        url: 'https://example.org/batteries',
        name: 'Example source',
        retrievedAt: '2026-10-27T12:00:00.000Z',
        relationship: 'Defines the core battery terms'
      }]
    }).where(eq(learningSession.id, accepted.sessionId));
    await db.insert(learningChatTurn).values({
      sessionId: accepted.sessionId,
      question: 'Private follow-up about the lesson',
      answer: 'Private assistant response'
    });

    const shared = await createShare({ ownerId, journeyId: accepted.journeyId, expiresAt: new Date(Date.now() + 60_000) });
    const snapshot = await readSharedSnapshot(shared.token);
    expect(Object.keys(snapshot!).sort()).toEqual(['goal', 'sessions', 'studyDays', 'version']);
    expect(snapshot!.sessions[0]).toMatchObject({ index: 1, title: 'Battery basics', lesson: 'Public lesson text' });
    expect(snapshot!.sessions[0].sources).toMatchObject([{ id: 'source-1', url: 'https://example.org/batteries' }]);
    expect(JSON.stringify(snapshot)).not.toContain('Private question');
    expect(JSON.stringify(snapshot)).not.toContain('Private follow-up about the lesson');
    expect(JSON.stringify(snapshot)).not.toContain('Private assistant response');

    const warning = await forkShare({
      ownerId: viewerId,
      token: shared.token,
      forkKey: 'fork-once',
      goal: 'Learn battery safety',
      studyDays: 7,
      dailyMinutes: 30
    });
    expect(warning).toMatchObject({ status: 'confirmation_required', sessionIndexes: [1] });

    const fork = await forkShare({
      ownerId: viewerId,
      token: shared.token,
      forkKey: 'fork-once',
      goal: 'Learn battery safety',
      studyDays: 7,
      dailyMinutes: 30,
      confirmedOverBudget: true
    });
    expect(fork).toMatchObject({ status: 'created' });
    const forkedJourney = await db.select().from(learningJourney).where(eq(learningJourney.id, fork.journeyId));
    expect(forkedJourney[0]).toMatchObject({ ownerUserId: viewerId, goal: 'Learn battery safety', conversationId: null, status: 'ready' });
    expect(await db.select().from(learningSession).where(eq(learningSession.journeyId, fork.journeyId))).toHaveLength(1);
    await expect(revokeShare({ ownerId: viewerId, shareId: shared.id })).rejects.toThrow();

    const continued = await continueJourney({ ownerId: viewerId, journeyId: fork.journeyId });
    expect(continued).toMatchObject({ status: 'created', sessionIndex: 2 });
    expect(await db.select().from(learningSession).where(eq(learningSession.journeyId, accepted.journeyId))).toHaveLength(1);
    expect(await db.select().from(learningSession).where(eq(learningSession.journeyId, fork.journeyId))).toHaveLength(2);

    await revokeShare({ ownerId, shareId: shared.id });
    await expect(readSharedSnapshot(shared.token)).resolves.toBeNull();
    await expect(forkShare({ ownerId: viewerId, token: shared.token, forkKey: 'new-fork', goal: 'Another goal', studyDays: 7, dailyMinutes: 60 })).rejects.toThrow();
    await expect(forkShare({ ownerId: viewerId, token: shared.token, forkKey: 'fork-once', goal: 'Learn battery safety', studyDays: 7, dailyMinutes: 30, confirmedOverBudget: true }))
      .resolves.toMatchObject({ journeyId: fork.journeyId });

    const expiring = await createShare({ ownerId, journeyId: accepted.journeyId, expiresAt: new Date(Date.now() + 60_000) });
    await db.update(learningShare).set({ expiresAt: new Date(Date.now() - 1) }).where(eq(learningShare.id, expiring.id));
    await expect(readSharedSnapshot(expiring.token)).resolves.toBeNull();
    await expect(forkShare({ ownerId: viewerId, token: expiring.token, forkKey: 'expired-fork', goal: 'Expired', studyDays: 7, dailyMinutes: 60 })).rejects.toThrow();
  });
});
