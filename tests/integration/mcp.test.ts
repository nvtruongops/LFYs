import { afterEach, describe, expect, it } from 'vitest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { eq } from 'drizzle-orm';
import { POST } from '../../src/routes/api/mcp/+server';
import { db } from '../../src/lib/server/db';
import { user } from '../../src/lib/server/db/schema/auth';
import { learningJourney } from '../../src/lib/server/db/schema/personal-learning';

const owners: string[] = [];

async function createOwner() {
  const id = crypto.randomUUID();
  owners.push(id);
  await db.insert(user).values({ id, name: 'MCP test', email: `lfys-${id}@example.test`, emailVerified: false });
  return id;
}

afterEach(async () => {
  for (const id of owners.splice(0)) await db.delete(user).where(eq(user.id, id));
});

describe('Personal Learning MCP adapter', () => {
  it('requires authentication and exposes only the caller’s journeys', async () => {
    const unauthenticated = await POST({ request: new Request('http://localhost/api/mcp', { method: 'POST' }), locals: { user: null } } as never);
    expect(unauthenticated.status).toBe(401);

    const ownerId = await createOwner();
    const otherOwnerId = await createOwner();
    await db.insert(learningJourney).values([
      { ownerUserId: ownerId, conversationId: null, goal: 'My goal', studyDays: 7, dailyMinutes: 30 },
      { ownerUserId: otherOwnerId, conversationId: null, goal: 'Private other goal', studyDays: 7, dailyMinutes: 30 }
    ]);

    const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      return POST({ request, locals: { user: { id: ownerId, name: 'MCP test' } } } as never);
    };
    const transport = new StreamableHTTPClientTransport(new URL('http://localhost/api/mcp'), { fetch });
    const client = new Client({ name: 'lfys-test-client', version: '1.0.0' }, {
      versionNegotiation: { mode: { pin: '2026-07-28' } }
    });
    await client.connect(transport);
    try {
      const tools = await client.listTools();
      expect(tools.tools.map(({ name }) => name).sort()).toEqual(['get_my_journey', 'list_my_journeys']);
      const result = await client.callTool({ name: 'list_my_journeys', arguments: {} });
      const payload = JSON.parse(result.content[0].text);
      expect(payload).toHaveLength(1);
      expect(payload[0].goal).toBe('My goal');

      const injected = await client.callTool({
        name: 'get_my_journey',
        arguments: { journeyId: "00000000-0000-0000-0000-000000000000'; DROP TABLE user;--" }
      });
      expect(injected.isError).toBe(true);
      expect(await db.select().from(user).where(eq(user.id, ownerId))).toHaveLength(1);

      const foreign = await client.callTool({
        name: 'get_my_journey',
        arguments: { journeyId: (await db.select({ id: learningJourney.id }).from(learningJourney).where(eq(learningJourney.ownerUserId, otherOwnerId)))[0].id }
      });
      expect(foreign.isError).toBe(true);
    } finally {
      await client.close();
    }
  });
});
