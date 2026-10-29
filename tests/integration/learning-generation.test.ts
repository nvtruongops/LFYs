import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { PgBoss } from 'pg-boss';
import { db } from '../../src/lib/server/db';
import { user } from '../../src/lib/server/db/schema/auth';
import { learningChatTurn, learningConversation, learningJourney, learningSession } from '../../src/lib/server/db/schema/personal-learning';
import { processLearningSession } from '../../src/lib/server/personal-learning/generation';
import { continueJourney, getLearningStatus } from '../../src/lib/server/personal-learning';

const owners: string[] = [];
const originalFetch = globalThis.fetch;

async function createSession() {
	const ownerId = crypto.randomUUID();
	owners.push(ownerId);
	await db.insert(user).values({ id: ownerId, name: 'Generation test', email: `generation-${ownerId}@example.test`, emailVerified: false });
	const [conversation] = await db.insert(learningConversation).values({
		ownerUserId: ownerId, question: 'How do plants use light?', answer: 'They use photosynthesis.', goal: 'Understand photosynthesis',
		language: 'English', priorKnowledge: '', offerStatus: 'accepted', consentGoal: 'Understand photosynthesis', consentStudyDays: 7,
		consentDailyMinutes: 30, consentedAt: new Date()
	}).returning({ id: learningConversation.id });
	const [journey] = await db.insert(learningJourney).values({
		ownerUserId: ownerId, conversationId: conversation.id, goal: 'Understand photosynthesis', studyDays: 7, dailyMinutes: 30
	}).returning({ id: learningJourney.id });
	const [session] = await db.insert(learningSession).values({
		journeyId: journey.id, sessionIndex: 1, idempotencyKey: `${journey.id}:session:1`
	}).returning({ id: learningSession.id });
	return { journeyId: journey.id, sessionId: session.id };
}

afterEach(async () => {
	vi.stubGlobal('fetch', originalFetch);
	for (const id of owners.splice(0)) await db.delete(user).where(eq(user.id, id));
});

describe('learning session generation worker', () => {
	it('uses only the previous session chat question as untrusted focus for explicit continuation', async () => {
		const { journeyId, sessionId } = await createSession();
		await db.update(learningSession).set({
			status: 'ready', title: 'Photosynthesis', lesson: 'Plants convert light into chemical energy.',
			activityMinutes: 20, sourceManifest: [{ id: 'source-1', url: 'https://example.org/plants', name: 'Plant guide', retrievedAt: new Date().toISOString(), relationship: 'Core explanation' }]
		}).where(eq(learningSession.id, sessionId));
		await db.update(learningJourney).set({ status: 'ready' }).where(eq(learningJourney.id, journeyId));
		await db.insert(learningChatTurn).values({ sessionId, question: 'How does chlorophyll capture light?', answer: 'It absorbs light.' });
		expect(await getLearningStatus(owners[owners.length - 1])).toMatchObject([{ nextFocus: 'Understand photosynthesis' }]);
		const next = await continueJourney({ ownerId: owners[owners.length - 1], journeyId });
		expect(next).toMatchObject({ status: 'created', sessionIndex: 2 });
		let generationBody: Record<string, unknown> = {};
		const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			if (String(input) === 'https://s.jina.ai/search') {
				return new Response(JSON.stringify({ data: [{ title: 'Official plant guide', url: 'https://example.org/plants', content: 'Chlorophyll absorbs light.' }] }), { headers: { 'content-type': 'application/json' } });
			}
			generationBody = JSON.parse(String(init?.body));
			return new Response(JSON.stringify({
				id: 'lesson', object: 'chat.completion', created: 1, model: 'local-model',
				choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify({ title: 'Capturing light', lesson: 'Chlorophyll absorbs light. [source-1]', activityMinutes: 20, citations: [{ sourceId: 'source-1', relationship: 'Supports the explanation' }] }) }, finish_reason: 'stop' }],
				usage: { prompt_tokens: 1, completion_tokens: 10, total_tokens: 11 }
			}), { headers: { 'content-type': 'application/json' } });
		});
		vi.stubGlobal('fetch', fetchMock);

		await processLearningSession(next.sessionId, 0);

		expect(JSON.stringify(generationBody.messages)).toContain('How does chlorophyll capture light?');
		expect(JSON.stringify(generationBody.messages)).toContain('untrusted');
		const sessions = await db.select().from(learningSession).where(eq(learningSession.journeyId, journeyId));
		expect(sessions).toHaveLength(2);
		expect(sessions[1]).toMatchObject({ sessionIndex: 2, status: 'ready' });
		expect(await getLearningStatus(owners[owners.length - 1])).toMatchObject([
			{},
			{ sessionIndex: 2, nextFocus: 'How does chlorophyll capture light?' }
		]);
	});

	it('limits same-journey jobs and persisted quota across separate pg-boss instances', async () => {
		const { journeyId } = await createSession();
		const queue = 'learning-session-concurrency-test';
		const bosses = [new PgBoss(process.env.DATABASE_URL!), new PgBoss(process.env.DATABASE_URL!)];
		const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
			await new Promise((resolve) => setTimeout(resolve, 100));
			return String(input) === 'https://s.jina.ai/search'
				? new Response(JSON.stringify({ data: [{ title: 'Official plant guide', url: 'https://example.org/plants', content: 'Photosynthesis converts light to chemical energy.' }] }), { headers: { 'content-type': 'application/json' } })
				: new Response(JSON.stringify({
					id: 'lesson', object: 'chat.completion', created: 1, model: 'local-model',
					choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify({ title: 'Photosynthesis', lesson: 'Plants store light energy chemically. [source-1]', activityMinutes: 20, citations: [{ sourceId: 'source-1', relationship: 'Supports the explanation' }] }) }, finish_reason: 'stop' }],
					usage: { prompt_tokens: 1, completion_tokens: 10, total_tokens: 11 }
				}), { headers: { 'content-type': 'application/json' } });
		});
		vi.stubGlobal('fetch', fetchMock);
		let finish!: () => void;
		let processed = 0;
		let readyWorkers = 0;
		let releaseWorkers!: () => void;
		const workersReady = new Promise<void>((resolve) => { releaseWorkers = resolve; });
		const completed = new Promise<void>((resolve) => { finish = resolve; });
		try {
			await Promise.all(bosses.map(async (boss) => { await boss.start(); await boss.createQueue(queue); }));
			await Promise.all(bosses.map((boss) => boss.work<{ sessionId: string }>(queue, {
				localConcurrency: 1,
				groupConcurrency: 2
			}, async (jobs) => {
				for (const job of jobs) {
					if (readyWorkers < 2) {
						if (++readyWorkers === 2) releaseWorkers();
						await workersReady;
					}
					await processLearningSession(job.data.sessionId, job.retryCount);
					if (++processed === 6) finish();
					}
				})));
			const [session] = await db.select({ id: learningSession.id }).from(learningSession).where(eq(learningSession.journeyId, journeyId));
			await Promise.all(Array.from({ length: 6 }, () => bosses[0].send(queue, { sessionId: session.id }, {
				id: crypto.randomUUID(),
				group: { id: journeyId }
			})));
			await Promise.race([completed, new Promise((_, reject) => setTimeout(() => reject(new Error('pg-boss jobs did not complete')), 30_000))]);

			const [journey] = await db.select().from(learningJourney).where(eq(learningJourney.id, journeyId));
			expect(fetchMock).toHaveBeenCalledTimes(2);
			expect(journey).toMatchObject({ searchesUsed: 1, sourcePagesUsed: 1, status: 'ready' });
		} finally {
			await Promise.all(bosses.map((boss) => boss.stop()));
		}
	}, 60_000);

	it('generates only session 1 from allowlisted sources and is a no-op when redelivered', async () => {
		const { journeyId, sessionId } = await createSession();
		const fetchMock = vi.fn(async (input: RequestInfo | URL) => String(input) === 'https://s.jina.ai/search'
			? new Response(JSON.stringify({ data: [{ title: 'Official plant guide', url: 'https://example.org/plants', content: 'Photosynthesis converts light to chemical energy.' }] }), { headers: { 'content-type': 'application/json' } })
			: new Response(JSON.stringify({
				id: 'lesson', object: 'chat.completion', created: 1, model: 'local-model',
				choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify({
					title: 'Photosynthesis', lesson: 'Plants store light energy chemically. [source-1]', activityMinutes: 20,
					citations: [{ sourceId: 'source-1', relationship: 'Supports the core explanation' }]
				}) }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 10, total_tokens: 11 }
			}), { headers: { 'content-type': 'application/json' } }));
		vi.stubGlobal('fetch', fetchMock);

		await processLearningSession(sessionId, 0);
		await db.update(learningSession).set({ title: 'Keep this lesson' }).where(eq(learningSession.id, sessionId));
		await processLearningSession(sessionId, 1);

		const [session] = await db.select().from(learningSession).where(eq(learningSession.id, sessionId));
		const [journey] = await db.select().from(learningJourney).where(eq(learningJourney.id, journeyId));
		expect(session).toMatchObject({ status: 'ready', title: 'Keep this lesson', activityMinutes: 20 });
		expect(session.sourceManifest).toMatchObject([{ id: 'source-1', url: 'https://example.org/plants', name: 'Official plant guide', relationship: 'Supports the core explanation' }]);
		expect(session.generationPromptVersion).toBeTruthy();
		expect(session.generationModelId).toBe('local-model');
		expect(journey).toMatchObject({ status: 'ready', searchesUsed: 1, sourcePagesUsed: 1 });
		expect(await db.select().from(learningSession).where(eq(learningSession.journeyId, journeyId))).toHaveLength(1);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('marks terminal provider failure without creating a ready lesson', async () => {
		const { journeyId, sessionId } = await createSession();
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('private provider response')));

		await expect(processLearningSession(sessionId, 2)).rejects.toThrow();

		const [session] = await db.select().from(learningSession).where(eq(learningSession.id, sessionId));
		const [journey] = await db.select().from(learningJourney).where(eq(learningJourney.id, journeyId));
		expect(session).toMatchObject({ status: 'failed', generationFailure: 'source_unavailable', lesson: null });
		expect(journey).toMatchObject({ status: 'failed', searchesUsed: 1, sourcePagesUsed: 0 });
	});

	it('recovers a generating session after a retryable source failure', async () => {
		const { sessionId } = await createSession();
		const fetchMock = vi.fn()
			.mockRejectedValueOnce(new Error('temporary source error'))
			.mockImplementationOnce(async (input: RequestInfo | URL) => String(input) === 'https://s.jina.ai/search'
				? new Response(JSON.stringify({ data: [{ title: 'Official plant guide', url: 'https://example.org/plants', content: 'Photosynthesis converts light to chemical energy.' }] }), { headers: { 'content-type': 'application/json' } })
				: new Response(JSON.stringify({
					id: 'lesson', object: 'chat.completion', created: 1, model: 'local-model',
					choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify({ title: 'Photosynthesis', lesson: 'Plants store light energy chemically. [source-1]', activityMinutes: 20, citations: [{ sourceId: 'source-1', relationship: 'Supports the explanation' }] }) }, finish_reason: 'stop' }],
					usage: { prompt_tokens: 1, completion_tokens: 10, total_tokens: 11 }
				}), { headers: { 'content-type': 'application/json' } }))
			.mockImplementationOnce(async () => new Response(JSON.stringify({
				id: 'lesson', object: 'chat.completion', created: 1, model: 'local-model',
				choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify({ title: 'Photosynthesis', lesson: 'Plants store light energy chemically. [source-1]', activityMinutes: 20, citations: [{ sourceId: 'source-1', relationship: 'Supports the explanation' }] }) }, finish_reason: 'stop' }],
				usage: { prompt_tokens: 1, completion_tokens: 10, total_tokens: 11 }
			}), { headers: { 'content-type': 'application/json' } }));
		vi.stubGlobal('fetch', fetchMock);

		await expect(processLearningSession(sessionId, 0)).rejects.toThrow();
		const [afterFailure] = await db.select().from(learningSession).where(eq(learningSession.id, sessionId));
		expect(afterFailure.status).toBe('generating');
		await processLearningSession(sessionId, 1);
		const [afterRetry] = await db.select().from(learningSession).where(eq(learningSession.id, sessionId));
		expect(afterRetry.status).toBe('ready');
	});
});
