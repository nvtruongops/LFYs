import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { PgBoss } from 'pg-boss';
import { db } from '../../src/lib/server/db';
import { user } from '../../src/lib/server/db/schema/auth';
import { learningConversation, learningJobOutbox, learningJourney, learningSession } from '../../src/lib/server/db/schema/personal-learning';
import { stopLearningQueue } from '../../src/lib/server/jobs';
import { actions, load } from '../../src/routes/(app)/learning/+page.server';

const owners: string[] = [];
const originalFetch = globalThis.fetch;

afterEach(async () => {
  vi.stubGlobal('fetch', originalFetch);
  vi.restoreAllMocks();
  await stopLearningQueue();
  for (const id of owners.splice(0)) await db.delete(user).where(eq(user.id, id));
});

describe('learning question action', () => {
  it('rejects oversized input before calling the model', async () => {
    const ownerId = crypto.randomUUID();
    owners.push(ownerId);
    await db.insert(user).values({
      id: ownerId,
      name: 'Learning route validation test',
      email: `learning-validation-${ownerId}@example.test`,
      emailVerified: false
    });
    const modelFetch = vi.fn();
    vi.stubGlobal('fetch', modelFetch);

    const result = await actions.ask({
      request: new Request('http://localhost/learning', {
        method: 'POST', body: new URLSearchParams({
          question: 'q'.repeat(2001), goal: 'Learn', language: 'English', priorKnowledge: ''
        })
      }),
      locals: { user: { id: ownerId } }
    } as never);

    expect(result).toMatchObject({ status: 400 });
    expect(modelFetch).not.toHaveBeenCalled();
    expect(await db.select().from(learningConversation).where(eq(learningConversation.ownerUserId, ownerId))).toHaveLength(0);
  });

  it('answers first and offers a journey without creating one before consent', async () => {
    const ownerId = crypto.randomUUID();
    owners.push(ownerId);
    await db.insert(user).values({
      id: ownerId,
      name: 'Learning route integration test',
      email: `learning-route-${ownerId}@example.test`,
      emailVerified: false
    });
    const modelFetch = vi.fn(async () => new Response(JSON.stringify({
      id: 'learning-answer-test', object: 'chat.completion', created: 1, model: 'local-model',
      choices: [{ index: 0, message: { role: 'assistant', content: 'Batteries store energy chemically.' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 5, total_tokens: 6 }
    }), { headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', modelFetch);

    const result = await actions.ask({
      request: new Request('http://localhost/learning', {
        method: 'POST', body: new URLSearchParams({
          question: 'How do batteries store energy?', goal: 'Understand electrochemistry', language: 'en', priorKnowledge: 'Basic chemistry'
        })
      }),
      locals: { user: { id: ownerId } }
    } as never);

    expect(result).toMatchObject({ answer: 'Batteries store energy chemically.', offer: true });
    const [conversation] = await db.select().from(learningConversation).where(eq(learningConversation.id, result.conversationId));
    expect(conversation).toMatchObject({ ownerUserId: ownerId, offerStatus: 'offered' });
    expect(await db.select().from(learningJourney).where(eq(learningJourney.conversationId, conversation.id))).toHaveLength(0);
    expect(await db.select().from(learningSession)
      .innerJoin(learningJourney, eq(learningSession.journeyId, learningJourney.id))
      .where(eq(learningJourney.ownerUserId, ownerId))).toHaveLength(0);

    const otherOwnerId = crypto.randomUUID();
    owners.push(otherOwnerId);
    await db.insert(user).values({
      id: otherOwnerId,
      name: 'Other learning route user',
      email: `learning-other-${otherOwnerId}@example.test`,
      emailVerified: false
    });
    const unauthorized = await actions.accept({
      request: new Request('http://localhost/learning', {
        method: 'POST', body: new URLSearchParams({
          conversationId: conversation.id, goal: 'Steal this journey', studyDays: '7', dailyMinutes: '30'
        })
      }),
      locals: { user: { id: otherOwnerId } }
    } as never);
    expect(unauthorized).toMatchObject({ status: 400 });
    expect(await db.select().from(learningJourney).where(eq(learningJourney.conversationId, conversation.id))).toHaveLength(0);

    const accepted = await actions.accept({
      request: new Request('http://localhost/learning', {
        method: 'POST', body: new URLSearchParams({
          conversationId: conversation.id, goal: 'Study battery chemistry', studyDays: '7', dailyMinutes: '30'
        })
      }),
      locals: { user: { id: ownerId } }
    } as never);
    expect(accepted).toMatchObject({ accepted: true });
    const [journey] = await db.select().from(learningJourney).where(eq(learningJourney.conversationId, conversation.id));
    expect(journey).toMatchObject({ ownerUserId: ownerId, goal: 'Study battery chemistry', studyDays: 7, dailyMinutes: 30 });
    expect(await db.select().from(learningSession).where(eq(learningSession.journeyId, journey.id))).toHaveLength(1);
    expect(modelFetch).toHaveBeenCalledTimes(1);
  });

  it('answers a learner who declines without source search or queued learning work', async () => {
    const ownerId = crypto.randomUUID();
    owners.push(ownerId);
    await db.insert(user).values({ id: ownerId, name: 'Declining learner', email: `learning-decline-${ownerId}@example.test`, emailVerified: false });
    const modelFetch = vi.fn(async () => new Response(JSON.stringify({
      id: 'answer-before-decline', object: 'chat.completion', created: 1, model: 'local-model',
      choices: [{ index: 0, message: { role: 'assistant', content: 'Photosynthesis stores energy.' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 5, total_tokens: 6 }
    }), { headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', modelFetch);

    const answer = await actions.ask({
      request: new Request('http://localhost/learning', { method: 'POST', body: new URLSearchParams({
        question: 'What does photosynthesis do?', goal: 'Learn biology', language: 'English', priorKnowledge: ''
      }) }),
      locals: { user: { id: ownerId } }
    } as never);
    const dismissed = await actions.dismiss({
      request: new Request('http://localhost/learning', { method: 'POST', body: new URLSearchParams({ conversationId: answer.conversationId }) }),
      locals: { user: { id: ownerId } }
    } as never);

    expect(answer).toMatchObject({ answer: 'Photosynthesis stores energy.', offer: true });
    expect(dismissed).toMatchObject({ dismissed: true });
    expect(modelFetch).toHaveBeenCalledOnce();
    expect(await db.select().from(learningJourney).where(eq(learningJourney.ownerUserId, ownerId))).toHaveLength(0);
    expect(await db.select().from(learningSession).innerJoin(learningJourney, eq(learningSession.journeyId, learningJourney.id)).where(eq(learningJourney.ownerUserId, ownerId))).toHaveLength(0);
    expect(await db.select().from(learningJobOutbox)
      .innerJoin(learningSession, eq(learningJobOutbox.sessionId, learningSession.id))
      .innerJoin(learningJourney, eq(learningSession.journeyId, learningJourney.id))
      .where(eq(learningJourney.ownerUserId, ownerId))).toHaveLength(0);
  });

  it('keeps retry owner-scoped and retries only an exhausted failed session with its stable ID', async () => {
    const ownerId = crypto.randomUUID();
    const otherOwnerId = crypto.randomUUID();
    owners.push(ownerId, otherOwnerId);
    await db.insert(user).values([
      { id: ownerId, name: 'Journey owner', email: `retry-owner-${ownerId}@example.test`, emailVerified: false },
      { id: otherOwnerId, name: 'Other owner', email: `retry-other-${otherOwnerId}@example.test`, emailVerified: false }
    ]);
    const [journey] = await db.insert(learningJourney).values({
      ownerUserId: ownerId, goal: 'Learn biology', studyDays: 7, dailyMinutes: 30, status: 'failed'
    }).returning({ id: learningJourney.id });
    const sessionId = crypto.randomUUID();
    await db.insert(learningSession).values({
      id: sessionId, journeyId: journey.id, sessionIndex: 1, status: 'failed',
      generationFailure: 'source_unavailable', idempotencyKey: `${journey.id}:session:1`
    });

    const pendingId = crypto.randomUUID();
    const [pendingJourney] = await db.insert(learningJourney).values({
      ownerUserId: ownerId, goal: 'Private pending journey', studyDays: 7, dailyMinutes: 30
    }).returning({ id: learningJourney.id });
    await db.insert(learningSession).values({
      id: pendingId, journeyId: pendingJourney.id, sessionIndex: 1, idempotencyKey: `${pendingJourney.id}:session:1`
    });

    const privateData = await load({ locals: { user: { id: ownerId, name: 'Journey owner' } } } as never);
    expect(privateData.journeys.map((item) => item.journeyId)).toContain(journey.id);
    const otherData = await load({ locals: { user: { id: otherOwnerId, name: 'Other owner' } } } as never);
    expect(otherData.journeys).toHaveLength(0);

    const pendingRetry = await actions.retry({
      request: new Request('http://localhost/learning', { method: 'POST', body: new URLSearchParams({ sessionId: pendingId }) }),
      locals: { user: { id: ownerId } }
    } as never);
    expect(pendingRetry).toMatchObject({ status: 400 });

    const unauthorized = await actions.retry({
      request: new Request('http://localhost/learning', { method: 'POST', body: new URLSearchParams({ sessionId }) }),
      locals: { user: { id: otherOwnerId } }
    } as never);
    expect(unauthorized).toMatchObject({ status: 400 });

    const invalidUrl = await actions.retry({
      request: new Request('http://localhost/learning', { method: 'POST', body: new URLSearchParams({ sessionId, sourceUrl: 'http://127.0.0.1/admin' }) }),
      locals: { user: { id: ownerId } }
    } as never);
    expect(invalidUrl).toMatchObject({ status: 400 });

    vi.spyOn(PgBoss.prototype, 'findJobs').mockResolvedValue([{ state: 'failed' }] as never);
    const retryJob = vi.spyOn(PgBoss.prototype, 'retry').mockResolvedValue({});
    const retried = await actions.retry({
      request: new Request('http://localhost/learning', { method: 'POST', body: new URLSearchParams({ sessionId, sourceUrl: 'https://docs.example.org/start' }) }),
      locals: { user: { id: ownerId } }
    } as never);

    expect(retried).toMatchObject({ retried: true, sessionId });
    expect(retryJob).toHaveBeenCalledWith('learning-session', sessionId, expect.objectContaining({ db: expect.anything() }));
    const [session] = await db.select().from(learningSession).where(eq(learningSession.id, sessionId));
    const [updatedJourney] = await db.select().from(learningJourney).where(eq(learningJourney.id, journey.id));
    expect(session).toMatchObject({ status: 'queued', sourceUrl: 'https://docs.example.org/start', generationFailure: null });
    expect(updatedJourney.status).toBe('sourcing');
    expect(await db.select().from(learningSession).where(eq(learningSession.journeyId, journey.id))).toHaveLength(1);
  });
});
