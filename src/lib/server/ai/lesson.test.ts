import { describe, expect, it, vi } from 'vitest';
import { generateSessionLesson } from './lesson';
import type { LearningSource } from '../personal-learning/sources/jina';

const sources: LearningSource[] = [{
	id: 'source-1', title: 'Official guide', url: 'https://example.org/guide', content: 'Photosynthesis converts light energy into chemical energy.', retrievedAt: '2026-10-27T00:00:00.000Z'
}];
const config = { AI_PROVIDER_API_KEY: 'local-key', AI_PROVIDER_BASE_URL: 'http://localhost:20128/v1', AI_PROVIDER_MODEL_ID: 'local-model' };
const response = (output: string) => new Response(JSON.stringify({
	id: 'lesson-test', object: 'chat.completion', created: 1, model: 'local-model',
	choices: [{ index: 0, message: { role: 'assistant', content: output }, finish_reason: 'stop' }],
	usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 }
}), { headers: { 'content-type': 'application/json' } });
const validDraft = JSON.stringify({ title: 'Photosynthesis', lesson: 'Plants convert light into stored chemical energy. [source-1]', activityMinutes: 20, citations: [{ sourceId: 'source-1', relationship: 'Supports the core definition' }] });

describe('citation-bound learning lesson', () => {
	it('generates within budget from untrusted source context without tools', async () => {
		let requestBody: Record<string, unknown> = {};
		const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
			requestBody = JSON.parse(String(init?.body));
			return response(validDraft);
		});

		const lesson = await generateSessionLesson({ goal: 'Understand photosynthesis', question: 'Why are leaves green?', priorKnowledge: 'I know plants need light.', language: 'English', dailyMinutes: 30, sources }, config, fetchImpl);

		expect(lesson).toMatchObject({ title: 'Photosynthesis', activityMinutes: 20, citations: [{ sourceId: 'source-1' }] });
		expect(requestBody.max_tokens).toBe(800);
		expect(requestBody.tools).toBeUndefined();
		expect(JSON.stringify(requestBody.messages)).toContain('untrusted');
		expect(JSON.stringify(requestBody.messages)).toContain(sources[0].content);
		expect(JSON.stringify(requestBody.messages)).toContain('Why are leaves green?');
		expect(JSON.stringify(requestBody.messages)).toContain('I know plants need light.');
	});

	it.each([
		['malformed output', '{'],
		['empty output', ''],
		['invented citation', JSON.stringify({ title: 'Lesson', lesson: 'Text [source-9]', activityMinutes: 10, citations: [{ sourceId: 'source-9', relationship: 'Supports it' }] })],
		['citation marker absent from the citation list', JSON.stringify({ title: 'Lesson', lesson: 'Text [source-1] and [source-9]', activityMinutes: 10, citations: [{ sourceId: 'source-1', relationship: 'Supports it' }] })],
		['citation not present in lesson text', JSON.stringify({ title: 'Lesson', lesson: 'Text without a source marker', activityMinutes: 10, citations: [{ sourceId: 'source-1', relationship: 'Supports it' }] })],
		['duplicate citation source IDs', JSON.stringify({ title: 'Lesson', lesson: 'Text [source-1]', activityMinutes: 10, citations: [{ sourceId: 'source-1', relationship: 'Supports it' }, { sourceId: 'source-1', relationship: 'Repeats it' }] })],
		['over-budget activity', JSON.stringify({ title: 'Lesson', lesson: 'Text [source-1]', activityMinutes: 31, citations: [{ sourceId: 'source-1', relationship: 'Supports it' }] })]
	])('rejects %s rather than returning a lesson', async (_name, output) => {
		await expect(generateSessionLesson(
			{ goal: 'Understand photosynthesis', question: 'Why are leaves green?', priorKnowledge: '', language: 'English', dailyMinutes: 30, sources },
			config,
			vi.fn().mockResolvedValue(response(output))
		)).rejects.toThrow();
	});
});
