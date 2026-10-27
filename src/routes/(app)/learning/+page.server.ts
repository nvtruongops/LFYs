import { fail, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { answerLearningQuestion } from '../../../lib/server/ai/answer';
import { acceptOffer, createAnsweredConversation, dismissOffer, getLearningStatus, retryLearningSession } from '../../../lib/server/personal-learning';

function field(form: FormData, name: string, maxLength: number) {
  const value = form.get(name);
  if (value === null) return '';
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text.length <= maxLength ? text : null;
}

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user) redirect(303, '/sign-in');
  return { learnerName: locals.user.name, journeys: await getLearningStatus(locals.user.id) };
};

export const actions = {
  ask: async ({ request, locals }) => {
    if (!locals.user) return fail(401, { error: 'Sign in to ask a question.' });
    const form = await request.formData();
    const question = field(form, 'question', 2000);
    const goal = field(form, 'goal', 500);
    const language = field(form, 'language', 80);
    const priorKnowledge = field(form, 'priorKnowledge', 1000);
    if (!question || !goal || !language || priorKnowledge === null) {
      return fail(400, { error: 'Enter a question, learning goal, and answer language. Keep each field within its limit.' });
    }

    let answer: string;
    try {
      answer = await answerLearningQuestion({ question, goal, language, priorKnowledge });
    } catch {
      return fail(502, { error: 'The local AI model could not answer right now. Please try again.' });
    }

    const conversation = await createAnsweredConversation({ ownerId: locals.user.id, question, answer, goal, language, priorKnowledge }, true);
    return { conversationId: conversation.id, question, answer, goal, offer: true };
  },

  dismiss: async ({ request, locals }) => {
    if (!locals.user) return fail(401, { error: 'Sign in to update this offer.' });
    const conversationId = field(await request.formData(), 'conversationId', 80);
    if (!conversationId) return fail(400, { error: 'The learning offer is invalid.' });
    try {
      await dismissOffer({ ownerId: locals.user.id, conversationId });
      return { dismissed: true };
    } catch {
      return fail(400, { error: 'This learning offer is no longer available.' });
    }
  },

  accept: async ({ request, locals }) => {
    if (!locals.user) return fail(401, { error: 'Sign in to accept this offer.' });
    const form = await request.formData();
    const conversationId = field(form, 'conversationId', 80);
    const goal = field(form, 'goal', 500);
    const studyDays = Number(field(form, 'studyDays', 3));
    const dailyMinutes = Number(field(form, 'dailyMinutes', 3));
    if (!conversationId || !goal) return fail(400, { error: 'Choose a learning goal before accepting.' });
    try {
      const journey = await acceptOffer({ ownerId: locals.user.id, conversationId, goal, studyDays, dailyMinutes });
      return { accepted: true, journeyId: journey.journeyId, sessionId: journey.sessionId };
    } catch {
      return fail(400, { error: 'This offer could not be accepted. Refresh and try again.' });
    }
  },

  retry: async ({ request, locals }) => {
    if (!locals.user) return fail(401, { error: 'Sign in to retry lesson generation.' });
    const form = await request.formData();
    const sessionId = field(form, 'sessionId', 80);
    const sourceUrl = field(form, 'sourceUrl', 2048);
    if (!sessionId || sourceUrl === null) return fail(400, { error: 'The retry request is invalid.' });
    try {
      const retried = await retryLearningSession({ ownerId: locals.user.id, sessionId, sourceUrl: sourceUrl || undefined });
      return { retried: true, sessionId: retried.sessionId };
    } catch {
      return fail(400, { error: 'This lesson cannot be retried. Check the URL and journey status.' });
    }
  }
};
