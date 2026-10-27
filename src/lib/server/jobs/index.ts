import { and, eq, sql } from 'drizzle-orm';
import { fromDrizzle, PgBoss } from 'pg-boss';
import { env } from '../env';
import { db } from '../db';
import { learningJobOutbox, learningSession } from '../db/schema/personal-learning';
import { processLearningSession } from '../personal-learning/generation';

const queueName = 'learning-session';
const boss = new PgBoss(env.DATABASE_URL);
let started: Promise<void> | undefined;
let workerStarted: Promise<void> | undefined;

async function startQueue() {
  started ??= boss.start().then(() => boss.createQueue(queueName)).catch((error: unknown) => {
    started = undefined;
    throw error;
  });
  await started;
  return reconcileQueuedOutbox();
}

async function sendLearningSession(tx: Parameters<typeof fromDrizzle>[0], sessionId: string, journeyId: string) {
  const id = await boss.send(queueName, { sessionId }, {
    id: sessionId,
    group: { id: journeyId },
    retryLimit: 2,
    retryDelay: 2,
    retryBackoff: true,
    db: fromDrizzle(tx, sql)
  });
  if (id !== sessionId) throw new Error('Could not enqueue learning session');
}

async function reconcileQueuedOutbox() {
  let reconciled = 0;
  for (;;) {
    const found = await db.transaction(async (tx) => {
      const [outbox] = await tx.select({ sessionId: learningJobOutbox.sessionId, journeyId: learningSession.journeyId })
        .from(learningJobOutbox)
        .innerJoin(learningSession, eq(learningJobOutbox.sessionId, learningSession.id))
        .where(eq(learningJobOutbox.status, 'queued'))
        .limit(1)
        .for('update', { skipLocked: true });
      if (!outbox) return false;

      await sendLearningSession(tx, outbox.sessionId, outbox.journeyId);
      await tx.update(learningJobOutbox)
        .set({ status: 'enqueued' })
        .where(and(
          eq(learningJobOutbox.sessionId, outbox.sessionId),
          eq(learningJobOutbox.status, 'queued')
        ));
      return true;
    });
    if (!found) return reconciled;
    reconciled += 1;
  }
}

export async function reconcileQueuedLearningSessions() {
  return startQueue();
}

export async function enqueueLearningSession(tx: Parameters<typeof fromDrizzle>[0], sessionId: string, journeyId: string) {
  await startQueue();
  await sendLearningSession(tx, sessionId, journeyId);
}

export async function startLearningWorker() {
  await startQueue();
  workerStarted ??= boss.work<{ sessionId: string }>(queueName, {
    localConcurrency: 1,
    groupConcurrency: 1
  }, async (jobs) => {
    for (const job of jobs) await processLearningSession(job.data.sessionId, job.retryCount);
  }).then(() => undefined).catch((error: unknown) => {
    workerStarted = undefined;
    throw error;
  });
  return workerStarted;
}

export async function retryFailedLearningJob(tx: Parameters<typeof fromDrizzle>[0], sessionId: string) {
  await startQueue();
  const jobs = await boss.findJobs(queueName, { id: sessionId });
  if (jobs.length !== 1 || jobs[0].state !== 'failed') throw new Error('Learning job is not retryable');
  await boss.retry(queueName, sessionId, { db: fromDrizzle(tx, sql) });
}

export async function stopLearningQueue() {
  if (!started) return;
  await boss.stop();
  started = undefined;
  workerStarted = undefined;
}
