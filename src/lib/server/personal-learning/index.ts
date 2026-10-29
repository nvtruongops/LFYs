import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { answerLessonChat } from '../ai/lesson-chat';
import { db } from '../db';
import { learningChatTurn, learningConversation, learningJobOutbox, learningJourney, learningSession } from '../db/schema';
import { enqueueLearningSession, retryFailedLearningJob } from '../jobs';
import { canContinue, isReviewBoundary, isValidExtension } from './cadence';
import { validateLearningSourceUrl } from './sources/jina';

const studyDayPresets = [1, 7, 30];
const dailyMinutePresets = [30, 60, 120];

export class LessonChatUnavailableError extends Error {}

export async function createAnsweredConversation(input: {
  ownerId: string;
  question: string;
  answer: string;
  goal: string;
  language: string;
  priorKnowledge: string;
}, offered = false) {
  const [conversation] = await db.insert(learningConversation).values({
    ownerUserId: input.ownerId,
    question: input.question,
    answer: input.answer,
    goal: input.goal,
    language: input.language,
    priorKnowledge: input.priorKnowledge,
    offerStatus: offered ? 'offered' : 'not_offered'
  }).returning({ id: learningConversation.id });
  return conversation;
}

export async function offerLearning(input: { ownerId: string; conversationId: string }) {
  const [conversation] = await db.select().from(learningConversation).where(and(
    eq(learningConversation.id, input.conversationId),
    eq(learningConversation.ownerUserId, input.ownerId)
  ));
  if (!conversation) throw new Error('Conversation not found or not owned');
  if (conversation.offerStatus === 'offered') return;
  if (conversation.offerStatus !== 'not_offered') throw new Error('Learning offer is no longer available');

  await db.update(learningConversation).set({ offerStatus: 'offered' }).where(and(
    eq(learningConversation.id, input.conversationId),
    eq(learningConversation.ownerUserId, input.ownerId),
    eq(learningConversation.offerStatus, 'not_offered')
  ));
}

export async function dismissOffer(input: { ownerId: string; conversationId: string }) {
  const [conversation] = await db.select().from(learningConversation).where(and(
    eq(learningConversation.id, input.conversationId),
    eq(learningConversation.ownerUserId, input.ownerId)
  ));
  if (!conversation) throw new Error('Conversation not found or not owned');
  if (conversation.offerStatus === 'dismissed') return;
  if (conversation.offerStatus !== 'offered') throw new Error('Learning offer is no longer available');

  await db.update(learningConversation).set({ offerStatus: 'dismissed' }).where(and(
    eq(learningConversation.id, input.conversationId),
    eq(learningConversation.ownerUserId, input.ownerId),
    eq(learningConversation.offerStatus, 'offered')
  ));
}

export async function acceptOffer(input: {
  ownerId: string;
  conversationId: string;
  goal: string;
  studyDays: number;
  dailyMinutes: number;
}) {
  const goal = input.goal.trim();
  if (!goal) throw new Error('Goal is required');
  if (!studyDayPresets.includes(input.studyDays)) throw new Error('Unsupported study-day target');
  if (!dailyMinutePresets.includes(input.dailyMinutes)) throw new Error('Unsupported daily time budget');

  return db.transaction(async (tx) => {
    const [conversation] = await tx.select().from(learningConversation).where(and(
      eq(learningConversation.id, input.conversationId),
      eq(learningConversation.ownerUserId, input.ownerId)
    )).for('update');
    if (!conversation) throw new Error('Conversation not found or not owned');

    const [existing] = await tx.select().from(learningJourney).where(eq(learningJourney.conversationId, input.conversationId));
    if (existing) {
      if (existing.goal !== goal || existing.studyDays !== input.studyDays || existing.dailyMinutes !== input.dailyMinutes) {
        throw new Error('Consent has already been recorded with different settings');
      }
      const [session] = await tx.select().from(learningSession).where(eq(learningSession.journeyId, existing.id)).orderBy(learningSession.sessionIndex).limit(1);
      return { journeyId: existing.id, sessionId: session.id, sessionIndex: 1 };
    }
    if (conversation.offerStatus !== 'offered') throw new Error('Explicit learning offer acceptance is required');

    const consentedAt = new Date();
    const [journey] = await tx.insert(learningJourney).values({
      ownerUserId: input.ownerId,
      conversationId: input.conversationId,
      goal,
      studyDays: input.studyDays,
      dailyMinutes: input.dailyMinutes
    }).returning({ id: learningJourney.id });
    const [session] = await tx.insert(learningSession).values({
      journeyId: journey.id,
      sessionIndex: 1,
      idempotencyKey: `${journey.id}:session:1`
    }).returning({ id: learningSession.id });
    await tx.insert(learningJobOutbox).values({
      sessionId: session.id,
      jobKey: `${journey.id}:session:1`
    });
    await enqueueLearningSession(tx, session.id, journey.id);
    await tx.update(learningJobOutbox).set({ status: 'enqueued' }).where(eq(learningJobOutbox.sessionId, session.id));
    await tx.update(learningConversation).set({
      offerStatus: 'accepted',
      consentGoal: goal,
      consentStudyDays: input.studyDays,
      consentDailyMinutes: input.dailyMinutes,
      consentedAt
    }).where(eq(learningConversation.id, conversation.id));

    return { journeyId: journey.id, sessionId: session.id, sessionIndex: 1 };
  });
}

export async function continueJourney(input: { ownerId: string; journeyId: string }) {
  return db.transaction(async (tx) => {
    const [journey] = await tx.select().from(learningJourney).where(and(
      eq(learningJourney.id, input.journeyId),
      eq(learningJourney.ownerUserId, input.ownerId)
    )).for('update');
    if (!journey) throw new Error('Journey not found or not owned');

    const [latest] = await tx.select().from(learningSession)
      .where(eq(learningSession.journeyId, journey.id))
      .orderBy(desc(learningSession.sessionIndex))
      .limit(1);
    if (!latest) throw new Error('Journey has no sessions');
    if (!canContinue(latest.sessionIndex, journey.studyDays)) return { status: 'goal_reached' as const };
    if (latest.status !== 'ready') {
      if (latest.sessionIndex > 1) {
        return { status: 'existing' as const, sessionId: latest.id, sessionIndex: latest.sessionIndex };
      }
      throw new Error('Current session is not ready');
    }

    const sessionIndex = latest.sessionIndex + 1;
    const idempotencyKey = `${journey.id}:session:${sessionIndex}`;
    const [session] = await tx.insert(learningSession).values({
      journeyId: journey.id,
      sessionIndex,
      idempotencyKey
    }).returning({ id: learningSession.id });
    await tx.insert(learningJobOutbox).values({ sessionId: session.id, jobKey: idempotencyKey });
    await enqueueLearningSession(tx, session.id, journey.id);
    await tx.update(learningJobOutbox).set({ status: 'enqueued' }).where(eq(learningJobOutbox.sessionId, session.id));
    return { status: 'created' as const, sessionId: session.id, sessionIndex };
  });
}

export async function extendJourney(input: { ownerId: string; journeyId: string; newTarget: number }) {
  return db.transaction(async (tx) => {
    const [journey] = await tx.select().from(learningJourney).where(and(
      eq(learningJourney.id, input.journeyId),
      eq(learningJourney.ownerUserId, input.ownerId)
    )).for('update');
    if (!journey) throw new Error('Journey not found or not owned');
    if (input.newTarget === journey.studyDays) return journey.studyDays;
    if (!isValidExtension(journey.studyDays, input.newTarget)) throw new Error('Invalid target extension');
    await tx.update(learningJourney).set({ studyDays: input.newTarget }).where(eq(learningJourney.id, journey.id));
    return input.newTarget;
  });
}

export async function getLearningStatus(ownerId: string) {
  const sessions = await db.select({
    journeyId: learningJourney.id,
    goal: learningJourney.goal,
    studyDays: learningJourney.studyDays,
    journeyStatus: learningJourney.status,
    sessionId: learningSession.id,
    sessionIndex: learningSession.sessionIndex,
    sessionStatus: learningSession.status,
    title: learningSession.title,
    lesson: learningSession.lesson,
    activityMinutes: learningSession.activityMinutes,
    sourceManifest: learningSession.sourceManifest,
    generationFailure: learningSession.generationFailure
  }).from(learningJourney)
    .innerJoin(learningSession, eq(learningSession.journeyId, learningJourney.id))
    .where(eq(learningJourney.ownerUserId, ownerId))
    .orderBy(desc(learningJourney.createdAt), learningSession.sessionIndex);

  if (sessions.length === 0) return [];
  const turns = await db.select().from(learningChatTurn)
    .where(inArray(learningChatTurn.sessionId, sessions.map((session) => session.sessionId)))
    .orderBy(asc(learningChatTurn.createdAt), asc(learningChatTurn.id));
  const latestIndex = new Map<string, number>();
  for (const session of sessions) latestIndex.set(session.journeyId, Math.max(latestIndex.get(session.journeyId) ?? 0, session.sessionIndex));
  return sessions.map((session) => {
    const priorSession = sessions.find((candidate) => candidate.journeyId === session.journeyId && candidate.sessionIndex === session.sessionIndex - 1);
    const priorQuestions = turns.filter((turn) => turn.sessionId === priorSession?.sessionId);
    return {
      ...session,
      isLatestSession: session.sessionIndex === latestIndex.get(session.journeyId),
      isReviewBoundary: isReviewBoundary(session.studyDays, session.sessionIndex),
      canContinue: canContinue(session.sessionIndex, session.studyDays),
      extensionTargets: [7, 30].filter((target) => isValidExtension(session.studyDays, target)),
      nextFocus: priorQuestions.at(-1)?.question ?? session.goal,
      chatTurns: turns.filter((turn) => turn.sessionId === session.sessionId)
    };
  });
}

export async function replyToLessonChat(input: { ownerId: string; sessionId: string; question: string }) {
  const [session] = await db.select({
    sessionId: learningSession.id,
    status: learningSession.status,
    title: learningSession.title,
    lesson: learningSession.lesson,
    language: learningConversation.language
  }).from(learningSession)
    .innerJoin(learningJourney, eq(learningSession.journeyId, learningJourney.id))
    .leftJoin(learningConversation, eq(learningJourney.conversationId, learningConversation.id))
    .where(and(eq(learningSession.id, input.sessionId), eq(learningJourney.ownerUserId, input.ownerId)));
  if (!session || session.status !== 'ready' || !session.title || !session.lesson) {
    throw new LessonChatUnavailableError('Lesson not found, not owned, or unavailable');
  }

  const recentTurns = await db.select({ question: learningChatTurn.question, answer: learningChatTurn.answer })
    .from(learningChatTurn)
    .where(eq(learningChatTurn.sessionId, session.sessionId))
    .orderBy(desc(learningChatTurn.createdAt), desc(learningChatTurn.id))
    .limit(10);
  const answer = await answerLessonChat({
    title: session.title,
    lesson: session.lesson,
    language: session.language ?? 'English',
    question: input.question,
    history: recentTurns.reverse().flatMap((turn) => [
      { role: 'user' as const, content: turn.question },
      { role: 'assistant' as const, content: turn.answer }
    ])
  });
  await db.insert(learningChatTurn).values({ sessionId: session.sessionId, question: input.question, answer });
  return answer;
}

export async function retryLearningSession(input: { ownerId: string; sessionId: string; sourceUrl?: string }) {
  const sourceUrl = input.sourceUrl ? validateLearningSourceUrl(input.sourceUrl) : undefined;
  if (input.sourceUrl && !sourceUrl) throw new Error('Invalid source URL');
  return db.transaction(async (tx) => {
    const [session] = await tx.select({
      sessionId: learningSession.id,
      journeyId: learningJourney.id,
      sessionIndex: learningSession.sessionIndex,
      sessionStatus: learningSession.status,
      journeyStatus: learningJourney.status,
      studyDays: learningJourney.studyDays
    }).from(learningSession)
      .innerJoin(learningJourney, eq(learningSession.journeyId, learningJourney.id))
      .where(and(eq(learningSession.id, input.sessionId), eq(learningJourney.ownerUserId, input.ownerId)))
      .for('update');
    if (!session || session.sessionIndex !== 1 || session.studyDays < 1 || session.sessionStatus !== 'failed' || session.journeyStatus !== 'failed') {
      throw new Error('Learning session is not retryable');
    }

    await tx.update(learningSession).set({
      status: 'queued',
      generationFailure: null,
      ...(sourceUrl ? { sourceUrl } : {})
    }).where(eq(learningSession.id, session.sessionId));
    await tx.update(learningJourney).set({ status: 'sourcing' }).where(eq(learningJourney.id, session.journeyId));
    await retryFailedLearningJob(tx, input.sessionId);
    return { sessionId: session.sessionId, journeyId: session.journeyId };
  });
}
