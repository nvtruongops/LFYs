import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { PgBoss } from 'pg-boss';
import { db } from '../../src/lib/server/db';
import { user } from '../../src/lib/server/db/schema/auth';
import { learningJobOutbox, learningJourney, learningSession } from '../../src/lib/server/db/schema/personal-learning';
import {
  acceptOffer,
  continueJourney,
  createAnsweredConversation,
  dismissOffer,
  extendJourney,
  offerLearning
} from '../../src/lib/server/personal-learning';
import { reconcileQueuedLearningSessions, stopLearningQueue } from '../../src/lib/server/jobs';
import { reserveLearningSourceSearch } from '../../src/lib/server/personal-learning/sources/quota';

const owners: string[] = [];

async function createOwner() {
	const id = crypto.randomUUID();
	owners.push(id);
	await db.insert(user).values({
		id,
		name: 'Learning integration test',
		email: `lfys-${id}@example.test`,
		emailVerified: false
	});
  return id;
}

async function createQueuedOutboxRow(ownerId: string, status: 'queued' | 'complete' | 'failed' = 'queued') {
  const [journey] = await db.insert(learningJourney).values({
    ownerUserId: ownerId,
    goal: 'Recover queued session',
    studyDays: 7,
    dailyMinutes: 30
  }).returning({ id: learningJourney.id });
  const sessionId = crypto.randomUUID();
  const jobKey = `${journey.id}:session:1`;
  await db.insert(learningSession).values({
    id: sessionId,
    journeyId: journey.id,
    sessionIndex: 1,
    idempotencyKey: jobKey
  });
  await db.insert(learningJobOutbox).values({ sessionId, jobKey, status });
  return { sessionId, jobKey };
}

afterEach(async () => {
  for (const id of owners.splice(0)) await db.delete(user).where(eq(user.id, id));
  await stopLearningQueue();
});

describe('Personal Learning consent persistence', () => {
	it('reserves no more than five searches and ten result pages under concurrent requests', async () => {
		const ownerId = await createOwner();
		const [journey] = await db.insert(learningJourney).values({
			ownerUserId: ownerId,
			goal: 'Bound source discovery',
			studyDays: 7,
			dailyMinutes: 30
		}).returning({ id: learningJourney.id });

		const reservations = await Promise.allSettled(Array.from({ length: 6 }, () => reserveLearningSourceSearch(journey.id)));
		const accepted = reservations.filter((result) => result.status === 'fulfilled');
		expect(accepted).toHaveLength(4);
		expect(accepted.reduce((total, result) => total + result.value.maxResults, 0)).toBe(10);
		expect(reservations.filter((result) => result.status === 'rejected')).toHaveLength(2);
	});

	it('reconciles queued outbox rows once, including concurrent passes', async () => {
    const ownerId = await createOwner();
    const queued = await createQueuedOutboxRow(ownerId);
    const completed = await createQueuedOutboxRow(ownerId, 'complete');
    const failed = await createQueuedOutboxRow(ownerId, 'failed');

    const recovered = await Promise.all([
      reconcileQueuedLearningSessions(),
      reconcileQueuedLearningSessions()
    ]);

    expect(recovered.reduce((total, count) => total + count, 0)).toBe(1);
    const [outbox] = await db.select().from(learningJobOutbox).where(eq(learningJobOutbox.sessionId, queued.sessionId));
    expect(outbox.status).toBe('enqueued');
    const [completedOutbox] = await db.select().from(learningJobOutbox).where(eq(learningJobOutbox.sessionId, completed.sessionId));
    const [failedOutbox] = await db.select().from(learningJobOutbox).where(eq(learningJobOutbox.sessionId, failed.sessionId));
    expect(completedOutbox.status).toBe('complete');
    expect(failedOutbox.status).toBe('failed');

    const boss = new PgBoss(process.env.DATABASE_URL!);
    await boss.start();
    try {
      await expect(boss.findJobs('learning-session', { id: queued.sessionId })).resolves.toHaveLength(1);
    } finally {
      await boss.stop();
    }

    await expect(reconcileQueuedLearningSessions()).resolves.toBe(0);
  });

  it('keeps a queued row retryable when sending to pg-boss fails', async () => {
    const ownerId = await createOwner();
    const queued = await createQueuedOutboxRow(ownerId);
    const send = vi.spyOn(PgBoss.prototype, 'send').mockRejectedValueOnce(new Error('simulated queue failure'));

    try {
      await expect(reconcileQueuedLearningSessions()).rejects.toThrow('simulated queue failure');
      const [afterFailure] = await db.select().from(learningJobOutbox).where(eq(learningJobOutbox.sessionId, queued.sessionId));
      expect(afterFailure.status).toBe('queued');
    } finally {
      send.mockRestore();
    }

    await expect(reconcileQueuedLearningSessions()).resolves.toBe(1);
    const [afterRetry] = await db.select().from(learningJobOutbox).where(eq(learningJobOutbox.sessionId, queued.sessionId));
    expect(afterRetry.status).toBe('enqueued');
  });

  it('creates only session 1 on explicit owner acceptance and deduplicates retries', async () => {
		const ownerId = await createOwner();
		const conversation = await createAnsweredConversation({
			ownerId,
			question: 'How do batteries store energy?',
			answer: 'A concise answer before any learning offer.',
			goal: 'Understand electrochemistry',
			language: 'en',
			priorKnowledge: 'Basic chemistry'
		});
		await offerLearning({ ownerId, conversationId: conversation.id });

		const consent = { ownerId, conversationId: conversation.id, goal: 'Study battery chemistry', studyDays: 7, dailyMinutes: 30 };
    const [first, retry] = await Promise.all([acceptOffer(consent), acceptOffer(consent)]);

		expect(retry).toEqual(first);
		expect(first.sessionIndex).toBe(1);
		expect(await db.select().from(learningSession).where(eq(learningSession.journeyId, first.journeyId))).toHaveLength(1);
		await expect(db.update(learningJourney).set({ studyDays: 8 }).where(eq(learningJourney.id, first.journeyId))).rejects.toThrow();
		await expect(db.insert(learningSession).values({
			journeyId: first.journeyId,
			sessionIndex: 1,
			idempotencyKey: `${first.journeyId}:duplicate`
		})).rejects.toThrow();
    const jobs = await db.select().from(learningJobOutbox).where(eq(learningJobOutbox.jobKey, `${first.journeyId}:session:1`));
    expect(jobs).toHaveLength(1);
    expect(jobs[0].status).toBe('enqueued');
	});

	it('does not create a journey after dismissal and rejects acceptance by another owner', async () => {
		const ownerId = await createOwner();
		const otherOwnerId = await createOwner();
		const conversation = await createAnsweredConversation({
			ownerId,
			question: 'What is photosynthesis?',
			answer: 'A concise answer.',
			goal: 'Learn photosynthesis',
			language: 'en',
			priorKnowledge: ''
		});
		await offerLearning({ ownerId, conversationId: conversation.id });
		await dismissOffer({ ownerId, conversationId: conversation.id });
    expect(await db.select().from(learningJourney).where(eq(learningJourney.conversationId, conversation.id))).toHaveLength(0);

		await expect(
			acceptOffer({
				ownerId: otherOwnerId,
				conversationId: conversation.id,
				goal: 'Steal journey',
				studyDays: 7,
				dailyMinutes: 30
			})
		).rejects.toThrow();
	});

	it('creates one next session on concurrent explicit continuation', async () => {
		const ownerId = await createOwner();
		const conversation = await createAnsweredConversation({
			ownerId,
			question: 'What is a cell?',
			answer: 'A concise answer.',
			goal: 'Understand cells',
			language: 'en',
			priorKnowledge: ''
		});
		await offerLearning({ ownerId, conversationId: conversation.id });
		const accepted = await acceptOffer({ ownerId, conversationId: conversation.id, goal: 'Understand cells', studyDays: 7, dailyMinutes: 30 });
		await db.update(learningSession).set({
			status: 'ready', title: 'Cell basics', lesson: 'A cell is a basic unit of life.', activityMinutes: 30,
			sourceManifest: [{ id: 'source-1', url: 'https://example.org/cells', name: 'Example', retrievedAt: '2026-10-27T12:00:00.000Z', relationship: 'Defines cells' }]
		}).where(eq(learningSession.journeyId, accepted.journeyId));

		const [first, retry] = await Promise.all([
			continueJourney({ ownerId, journeyId: accepted.journeyId }),
			continueJourney({ ownerId, journeyId: accepted.journeyId })
		]);

		expect(first.sessionId).toBe(retry.sessionId);
		expect(first.sessionIndex).toBe(2);
		expect(retry.sessionIndex).toBe(2);
		expect(await db.select().from(learningSession).where(eq(learningSession.journeyId, accepted.journeyId))).toHaveLength(2);
	});

	it('stops at the target and extends without enqueuing a session', async () => {
		const ownerId = await createOwner();
		const conversation = await createAnsweredConversation({
			ownerId,
			question: 'What is gravity?',
			answer: 'A concise answer.',
			goal: 'Understand gravity',
			language: 'en',
			priorKnowledge: ''
		});
		await offerLearning({ ownerId, conversationId: conversation.id });
		const accepted = await acceptOffer({ ownerId, conversationId: conversation.id, goal: 'Understand gravity', studyDays: 1, dailyMinutes: 30 });
		await db.update(learningSession).set({
			status: 'ready', title: 'Gravity basics', lesson: 'Gravity attracts masses.', activityMinutes: 30,
			sourceManifest: [{ id: 'source-1', url: 'https://example.org/gravity', name: 'Example', retrievedAt: '2026-10-27T12:00:00.000Z', relationship: 'Explains gravity' }]
		}).where(eq(learningSession.journeyId, accepted.journeyId));

		await expect(continueJourney({ ownerId, journeyId: accepted.journeyId })).resolves.toMatchObject({ status: 'goal_reached' });
		await extendJourney({ ownerId, journeyId: accepted.journeyId, newTarget: 7 });

		const journeys = await db.select().from(learningJourney).where(eq(learningJourney.id, accepted.journeyId));
		expect(journeys[0].studyDays).toBe(7);
		expect(await db.select().from(learningSession).where(eq(learningSession.journeyId, accepted.journeyId))).toHaveLength(1);
	});

	it('does not allow a session to become ready without a lesson and verified sources', async () => {
		const ownerId = await createOwner();
		const conversation = await createAnsweredConversation({
			ownerId,
			question: 'How does a battery work?',
			answer: 'A concise answer.',
			goal: 'Understand batteries',
			language: 'en',
			priorKnowledge: ''
		});
		await offerLearning({ ownerId, conversationId: conversation.id });
		const accepted = await acceptOffer({ ownerId, conversationId: conversation.id, goal: 'Understand batteries', studyDays: 7, dailyMinutes: 30 });

		await expect(db.update(learningSession).set({ status: 'ready' }).where(eq(learningSession.id, accepted.sessionId))).rejects.toThrow();
	});
});
