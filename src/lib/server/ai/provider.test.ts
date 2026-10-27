import { describe, expect, it } from 'vitest';
import { generateText } from 'ai';
import { createLocalModel } from './provider';

describe('local AI model provider', () => {
  it('sends the configured model and key to the OpenAI-compatible endpoint', async () => {
    let requestUrl = '';
    let requestHeaders = new Headers();
    let requestBody: Record<string, unknown> = {};
    const model = createLocalModel({
      AI_PROVIDER_API_KEY: 'local-test-secret',
      AI_PROVIDER_BASE_URL: 'http://localhost:20128/v1',
      AI_PROVIDER_MODEL_ID: 'cx/gpt-6-luna'
    }, async (input, init) => {
      requestUrl = String(input);
      requestHeaders = new Headers(init?.headers);
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        id: 'chatcmpl-test',
        object: 'chat.completion',
        created: 1,
        model: 'cx/gpt-6-luna',
        choices: [{ index: 0, message: { role: 'assistant', content: 'Local model ready.' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 3, total_tokens: 4 }
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });

    const result = await generateText({ model, prompt: 'Reply with a short readiness message.' });

    expect(requestUrl).toBe('http://localhost:20128/v1/chat/completions');
    expect(requestHeaders.get('authorization')).toBe('Bearer local-test-secret');
    expect(requestBody.model).toBe('cx/gpt-6-luna');
    expect(result.text).toBe('Local model ready.');
  });

  it('refuses an incomplete configuration before making a request', () => {
    expect(() => createLocalModel({ AI_PROVIDER_API_KEY: '', AI_PROVIDER_BASE_URL: '', AI_PROVIDER_MODEL_ID: '' }))
      .toThrow('AI provider is not configured');
  });
});
