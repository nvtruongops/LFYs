import 'dotenv/config';
import { generateText } from 'ai';
import { createLocalModel } from '../src/lib/server/ai/provider.ts';

if (!process.env.AI_PROVIDER_API_KEY) {
  console.error('Local model provider is not configured; run scripts/configure-local-provider.sh.');
  process.exit(1);
}

try {
  await generateText({
    model: createLocalModel(process.env),
    prompt: 'Reply with exactly OK.',
    maxOutputTokens: 8,
    abortSignal: AbortSignal.timeout(30_000)
  });
  console.log(`Local model provider is ready (${process.env.AI_PROVIDER_MODEL_ID}).`);
} catch {
  console.error('Local model check failed; verify the endpoint, model ID, and local API key. Details were suppressed.');
  process.exitCode = 1;
}
