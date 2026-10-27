import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

export type LocalModelConfig = {
  AI_PROVIDER_API_KEY?: string;
  AI_PROVIDER_BASE_URL?: string;
  AI_PROVIDER_MODEL_ID?: string;
};

export function createLocalModel(config: LocalModelConfig, fetchImpl: typeof fetch = fetch) {
  const { AI_PROVIDER_API_KEY: apiKey, AI_PROVIDER_BASE_URL: baseURL, AI_PROVIDER_MODEL_ID: modelId } = config;
  if (!apiKey || !baseURL || !modelId) throw new Error('AI provider is not configured');

  const provider = createOpenAICompatible({ name: 'lfysLocal', apiKey, baseURL, fetch: fetchImpl });
  return provider(modelId);
}
