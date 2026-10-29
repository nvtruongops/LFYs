import { and, desc, eq } from 'drizzle-orm';
import { generateSessionLesson } from '../ai/lesson';
import { db, pool } from '../db';
import { learningChatTurn, learningConversation, learningJobOutbox, learningJourney, learningSession } from '../db/schema/personal-learning';
import { env } from '../env';
import { releaseUnusedSourcePages, reserveLearningSourceSearch } from './sources/quota';
import { searchLearningSources } from './sources/jina';

export const lessonPromptVersion = 'lesson-v1';

export async function processLearningSession(sessionId: string, retryCount: number): Promise<void> {
	const client = await pool.connect();
	let journeyId: string | undefined;
	let lockAcquired = false;
	try {
		const [session] = await db.select({ journeyId: learningSession.journeyId })
			.from(learningSession).where(eq(learningSession.id, sessionId));
		if (!session) throw new Error('Learning session unavailable');
		journeyId = session.journeyId;
		await client.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [journeyId]);
		lockAcquired = true;
		await processLockedLearningSession(sessionId, retryCount);
	} finally {
		try {
			if (lockAcquired && journeyId) await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [journeyId]);
		} finally {
			client.release();
		}
	}
}

async function processLockedLearningSession(sessionId: string, retryCount: number): Promise<void> {
	const context = await db.transaction(async (tx) => {
		const [row] = await tx.select({
			sessionStatus: learningSession.status,
			sessionIndex: learningSession.sessionIndex,
			journeyId: learningJourney.id,
			goal: learningJourney.goal,
			dailyMinutes: learningJourney.dailyMinutes,
			sourceUrl: learningSession.sourceUrl,
			conversationId: learningJourney.conversationId
		}).from(learningSession)
			.innerJoin(learningJourney, eq(learningSession.journeyId, learningJourney.id))
			.where(eq(learningSession.id, sessionId)).for('update');
		if (!row) throw new Error('Learning session unavailable');
		if (row.sessionStatus === 'ready') return null;

		await tx.update(learningSession).set({ status: 'generating', generationFailure: null }).where(eq(learningSession.id, sessionId));
		await tx.update(learningJourney).set({ status: 'sourcing' }).where(eq(learningJourney.id, row.journeyId));
		const [conversation] = row.conversationId
			? await tx.select({ question: learningConversation.question, language: learningConversation.language, priorKnowledge: learningConversation.priorKnowledge })
				.from(learningConversation).where(eq(learningConversation.id, row.conversationId))
			: [];
		if (!conversation) throw new Error('Learning session unavailable');
		const [priorSession] = row.sessionIndex > 1
			? await tx.select({ id: learningSession.id }).from(learningSession)
				.where(and(eq(learningSession.journeyId, row.journeyId), eq(learningSession.sessionIndex, row.sessionIndex - 1), eq(learningSession.status, 'ready')))
			: [];
		const [latestQuestion] = priorSession
			? await tx.select({ question: learningChatTurn.question }).from(learningChatTurn)
				.where(eq(learningChatTurn.sessionId, priorSession.id)).orderBy(desc(learningChatTurn.createdAt), desc(learningChatTurn.id)).limit(1)
			: [];
		return { ...row, ...conversation, learnerEvidence: latestQuestion ? [latestQuestion.question] : [] };
	});
	if (!context) return;

	let stage: 'source' | 'generation' = 'source';
	let reservedPages = 0;
	try {
		const quota = await reserveLearningSourceSearch(context.journeyId);
		reservedPages = quota.maxResults;
		const sources = await searchLearningSources({ query: context.goal, sourceUrl: context.sourceUrl ?? undefined }, {
			apiKey: env.SOURCE_SEARCH_API_KEY ?? '',
			maxResults: quota.maxResults
		});
		await releaseUnusedSourcePages(context.journeyId, reservedPages, sources.length);
		reservedPages = 0;
		await db.update(learningJourney).set({ status: 'generating' }).where(eq(learningJourney.id, context.journeyId));
		stage = 'generation';
		const lesson = await generateSessionLesson({
			goal: context.goal,
			question: context.question,
			priorKnowledge: context.priorKnowledge,
			learnerEvidence: context.learnerEvidence,
			language: context.language,
			dailyMinutes: context.dailyMinutes,
			sources
		});
		const citedSources = lesson.citations.map((citation) => {
			const source = sources.find((candidate) => candidate.id === citation.sourceId);
			if (!source) throw new Error('Generated lesson failed validation');
			return { id: source.id, url: source.url, name: source.title, retrievedAt: source.retrievedAt, relationship: citation.relationship };
		});
		await db.transaction(async (tx) => {
			await tx.update(learningSession).set({
				status: 'ready',
				title: lesson.title,
				lesson: lesson.lesson,
				activityMinutes: lesson.activityMinutes,
				sourceManifest: citedSources,
				generationPromptVersion: lessonPromptVersion,
				generationModelId: env.AI_PROVIDER_MODEL_ID ?? null,
				generatedAt: new Date(),
				generationFailure: null
			}).where(and(eq(learningSession.id, sessionId), eq(learningSession.status, 'generating')));
			await tx.update(learningJourney).set({ status: 'ready' }).where(eq(learningJourney.id, context.journeyId));
			await tx.update(learningJobOutbox).set({ status: 'complete' }).where(eq(learningJobOutbox.sessionId, sessionId));
		});
	} catch {
		if (reservedPages > 0) await releaseUnusedSourcePages(context.journeyId, reservedPages, 0);
		if (retryCount >= 2) {
			await db.transaction(async (tx) => {
				await tx.update(learningSession).set({ status: 'failed', generationFailure: stage === 'source' ? 'source_unavailable' : 'generation_unavailable' }).where(eq(learningSession.id, sessionId));
				await tx.update(learningJourney).set({ status: 'failed' }).where(eq(learningJourney.id, context.journeyId));
				await tx.update(learningJobOutbox).set({ status: 'failed' }).where(eq(learningJobOutbox.sessionId, sessionId));
			});
		}
		throw new Error('Learning session generation failed');
	}
}
