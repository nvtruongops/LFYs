import { error, json, type RequestHandler } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.js';
import { learningJourney } from '#lib/server/db/schema/personal-learning.js';
import { createShare } from '#lib/server/personal-learning/sharing/index.js';

export const POST: RequestHandler = async ({ locals, params }) => {
  if (!locals.user) error(401, 'Authentication required');
  if (!params.journeyId) error(404, 'Ready journey not found');
  const [journey] = await db.select({ id: learningJourney.id }).from(learningJourney).where(and(
    eq(learningJourney.id, params.journeyId),
    eq(learningJourney.ownerUserId, locals.user.id),
    eq(learningJourney.status, 'ready')
  ));
  if (!journey) error(404, 'Ready journey not found');
  const share = await createShare({
    ownerId: locals.user.id,
    journeyId: journey.id,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  });
  return json(share, { status: 201, headers: { 'cache-control': 'no-store' } });
};
