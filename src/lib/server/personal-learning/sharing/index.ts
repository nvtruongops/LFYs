import { createHash, randomBytes } from 'node:crypto';
import { and, asc, eq, gt, isNull } from 'drizzle-orm';
import { db } from '../../db';
import { learningForkLineage, learningJourney, learningSession, learningShare, type LearningSnapshot } from '../../db/schema';

const studyTargets = [1, 7, 30];
const timeBudgets = [30, 60, 120];

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function parseSources(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) throw new Error('Ready sessions require verified sources');
  return value.map((source) => {
    if (!source || typeof source !== 'object') throw new Error('Invalid source manifest');
    const item = source as Record<string, unknown>;
    if (typeof item.url !== 'string' || typeof item.name !== 'string' || typeof item.retrievedAt !== 'string' || typeof item.relationship !== 'string') {
      throw new Error('Invalid source manifest');
    }
    const url = new URL(item.url);
    if (url.protocol !== 'https:' || url.username || url.password || Number.isNaN(Date.parse(item.retrievedAt))) {
      throw new Error('Invalid source manifest');
    }
    return { ...(typeof item.id === 'string' ? { id: item.id } : {}), url: url.href, name: item.name, retrievedAt: item.retrievedAt, relationship: item.relationship };
  });
}

export async function createShare(input: { ownerId: string; journeyId: string; expiresAt: Date }) {
  if (input.expiresAt <= new Date()) throw new Error('Share expiry must be in the future');
  return db.transaction(async (tx) => {
    const [journey] = await tx.select().from(learningJourney).where(and(
      eq(learningJourney.id, input.journeyId),
      eq(learningJourney.ownerUserId, input.ownerId)
    )).for('update');
    if (!journey || journey.status !== 'ready') throw new Error('Ready journey not found or not owned');

    const sessions = await tx.select().from(learningSession)
      .where(eq(learningSession.journeyId, journey.id))
      .orderBy(asc(learningSession.sessionIndex));
    if (!sessions.length || sessions.some((session) => session.status !== 'ready')) throw new Error('All shared sessions must be ready');

    const snapshot: LearningSnapshot = {
      version: 1,
      goal: journey.goal,
      studyDays: journey.studyDays,
      sessions: sessions.map((session) => {
        if (!session.title || !session.lesson || session.activityMinutes === null || session.activityMinutes > journey.dailyMinutes) {
          throw new Error('Session does not fit the journey time budget');
        }
        return {
          index: session.sessionIndex,
          title: session.title,
          lesson: session.lesson,
          activityMinutes: session.activityMinutes,
          sources: parseSources(session.sourceManifest)
        };
      })
    };
    const token = randomBytes(32).toString('base64url');
    const [share] = await tx.insert(learningShare).values({
      ownerUserId: input.ownerId,
      journeyId: journey.id,
      tokenHash: hashToken(token),
      snapshot,
      expiresAt: input.expiresAt
    }).returning({ id: learningShare.id });
    return { id: share.id, token, expiresAt: input.expiresAt };
  });
}

export async function readSharedSnapshot(token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const [share] = await db.select({ snapshot: learningShare.snapshot }).from(learningShare).where(and(
    eq(learningShare.tokenHash, hashToken(token)),
    gt(learningShare.expiresAt, new Date()),
    isNull(learningShare.revokedAt)
  ));
  return share?.snapshot ?? null;
}

export async function revokeShare(input: { ownerId: string; shareId: string }) {
  const [share] = await db.select().from(learningShare).where(and(
    eq(learningShare.id, input.shareId),
    eq(learningShare.ownerUserId, input.ownerId)
  ));
  if (!share) throw new Error('Share not found or not owned');
  if (share.revokedAt) return;
  await db.update(learningShare).set({ revokedAt: new Date() }).where(eq(learningShare.id, share.id));
}

export async function forkShare(input: {
  ownerId: string;
  token: string;
  forkKey: string;
  goal: string;
  studyDays: number;
  dailyMinutes: number;
  confirmedOverBudget?: boolean;
}) {
  const goal = input.goal.trim();
  if (!goal || !studyTargets.includes(input.studyDays) || !timeBudgets.includes(input.dailyMinutes) || !/^[A-Za-z0-9_-]{1,128}$/.test(input.forkKey)) {
    throw new Error('Invalid fork settings');
  }
  if (!/^[A-Za-z0-9_-]{43}$/.test(input.token)) throw new Error('Share is unavailable');

  return db.transaction(async (tx) => {
    const [share] = await tx.select().from(learningShare).where(eq(learningShare.tokenHash, hashToken(input.token))).for('update');
    if (!share) throw new Error('Share is unavailable');

    const [existingLineage] = await tx.select().from(learningForkLineage).where(and(
      eq(learningForkLineage.sourceShareId, share.id),
      eq(learningForkLineage.ownerUserId, input.ownerId),
      eq(learningForkLineage.forkKey, input.forkKey)
    ));
    if (existingLineage) {
      const [existingJourney] = await tx.select().from(learningJourney).where(eq(learningJourney.id, existingLineage.journeyId));
      if (existingJourney.goal !== goal || existingJourney.studyDays !== input.studyDays || existingJourney.dailyMinutes !== input.dailyMinutes) {
        throw new Error('Fork key was already used with different settings');
      }
      return { status: 'existing' as const, journeyId: existingJourney.id };
    }
    if (share.revokedAt || share.expiresAt <= new Date()) throw new Error('Share is unavailable');

    const snapshot = share.snapshot;
    if (snapshot.sessions.length > input.studyDays) throw new Error('Study target must include every copied session');
    const sessionIndexes = snapshot.sessions.filter((session) => session.activityMinutes > input.dailyMinutes).map((session) => session.index);
    if (sessionIndexes.length && !input.confirmedOverBudget) {
      return { status: 'confirmation_required' as const, sessionIndexes };
    }

    const [journey] = await tx.insert(learningJourney).values({
      ownerUserId: input.ownerId,
      conversationId: null,
      goal,
      studyDays: input.studyDays,
      dailyMinutes: input.dailyMinutes,
      status: 'ready'
    }).returning({ id: learningJourney.id });
    for (const session of snapshot.sessions) {
      await tx.insert(learningSession).values({
        journeyId: journey.id,
        sessionIndex: session.index,
        status: 'ready',
        title: session.title,
        lesson: session.lesson,
        activityMinutes: session.activityMinutes,
        sourceManifest: session.sources,
        idempotencyKey: `${journey.id}:session:${session.index}`
      });
    }
    await tx.insert(learningForkLineage).values({
      journeyId: journey.id,
      sourceShareId: share.id,
      ownerUserId: input.ownerId,
      forkKey: input.forkKey
    });
    return { status: 'created' as const, journeyId: journey.id };
  });
}
