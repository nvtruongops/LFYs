import { and, asc, eq } from 'drizzle-orm';
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { db } from '../db';
import { learningJourney, learningSession } from '../db/schema';

export function createLearningMcpHandler(ownerId: string) {
  return createMcpHandler(() => {
    const server = new McpServer({ name: 'lfys-personal-learning', version: '1.0.0' });

    server.registerTool('list_my_journeys', {
      description: 'List only the authenticated learner’s learning journeys and session status.',
      inputSchema: z.object({})
    }, async () => {
      const journeys = await db.select({
        id: learningJourney.id,
        goal: learningJourney.goal,
        status: learningJourney.status,
        studyDays: learningJourney.studyDays,
        dailyMinutes: learningJourney.dailyMinutes,
        createdAt: learningJourney.createdAt
      }).from(learningJourney)
        .where(eq(learningJourney.ownerUserId, ownerId))
        .orderBy(asc(learningJourney.createdAt));

      return { content: [{ type: 'text', text: JSON.stringify(journeys) }] };
    });

    server.registerTool('get_my_journey', {
      description: 'Read one of the authenticated learner’s journeys and its lessons.',
      inputSchema: z.object({ journeyId: z.string().uuid() })
    }, async ({ journeyId }) => {
      const [journey] = await db.select({
        id: learningJourney.id,
        goal: learningJourney.goal,
        status: learningJourney.status,
        studyDays: learningJourney.studyDays,
        dailyMinutes: learningJourney.dailyMinutes
      }).from(learningJourney).where(and(
        eq(learningJourney.id, journeyId),
        eq(learningJourney.ownerUserId, ownerId)
      ));
      if (!journey) return { isError: true, content: [{ type: 'text', text: 'Journey not found.' }] };

      const sessions = await db.select({
        index: learningSession.sessionIndex,
        status: learningSession.status,
        title: learningSession.title,
        lesson: learningSession.lesson,
        activityMinutes: learningSession.activityMinutes,
        sources: learningSession.sourceManifest
      }).from(learningSession)
        .where(eq(learningSession.journeyId, journey.id))
        .orderBy(asc(learningSession.sessionIndex));

      return { content: [{ type: 'text', text: JSON.stringify({ ...journey, sessions }) }] };
    });

    return server;
  }, { legacy: 'reject' });
}
