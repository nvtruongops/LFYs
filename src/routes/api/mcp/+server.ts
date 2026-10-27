import { json, type RequestHandler } from '@sveltejs/kit';
import { createLearningMcpHandler } from '#lib/server/mcp/index.js';

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) return json({ error: 'Authentication required' }, { status: 401 });
  return createLearningMcpHandler(locals.user.id).fetch(request);
};
