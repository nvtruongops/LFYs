import { describe, expect, it } from 'vitest';
import { answerLearningQuestion } from './answer';

describe('answerLearningQuestion', () => {
  it('answers the learner using only the local model and labels no sources', async () => {
    let requestBody: Record<string, unknown> = {};
    const answer = await answerLearningQuestion({
      question: 'How do batteries store energy?',
      goal: 'Understand electrochemistry',
      language: 'en',
      priorKnowledge: 'Basic chemistry'
    }, {
      AI_PROVIDER_API_KEY: 'test-key',
      AI_PROVIDER_BASE_URL: 'http://localhost:20128/v1',
      AI_PROVIDER_MODEL_ID: 'local-model'
    }, async (_input, init) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        id: 'answer-test',
        object: 'chat.completion',
        created: 1,
        model: 'local-model',
        choices: [{ index: 0, message: { role: 'assistant', content: 'Batteries store energy chemically.' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 5, total_tokens: 6 }
      }), { headers: { 'content-type': 'application/json' } });
    });

    expect(answer).toBe('Batteries store energy chemically.');
    const messages = requestBody.messages as Array<{ role: string; content: string }>;
    expect(messages[0].content).toContain('Do not use or invent sources or citations');
    expect(messages[1].content).toContain('How do batteries store energy?');
    expect(messages[1].content).toContain('Basic chemistry');
    expect(requestBody.max_tokens).toBe(800);
  });

  it('rejects an empty model response', async () => {
    await expect(answerLearningQuestion({
      question: 'Question', goal: 'Goal', language: 'en', priorKnowledge: ''
    }, {
      AI_PROVIDER_API_KEY: 'test-key',
      AI_PROVIDER_BASE_URL: 'http://localhost:20128/v1',
      AI_PROVIDER_MODEL_ID: 'local-model'
    }, async () => new Response(JSON.stringify({
      id: 'answer-test', object: 'chat.completion', created: 1, model: 'local-model',
      choices: [{ index: 0, message: { role: 'assistant', content: '' }, finish_reason: 'stop' }]
    }), { headers: { 'content-type': 'application/json' } }))).rejects.toThrow('Local model returned an empty answer');
  });
});
