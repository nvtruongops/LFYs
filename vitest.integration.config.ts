import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [sveltekit()],
	test: {
		include: ['tests/integration/**/*.test.ts'],
		environment: 'node',
		fileParallelism: false,
		env: {
			APP_ORIGIN: 'http://localhost:5173',
			DATABASE_URL: 'postgresql://lfys:lfys_dev_only@localhost:5432/lfys',
			BETTER_AUTH_URL: 'http://localhost:5173',
			BETTER_AUTH_SECRET: 'development-test-secret-32-characters',
			AI_PROVIDER_API_KEY: 'integration-test-key',
			AI_PROVIDER_BASE_URL: 'http://localhost:20128/v1',
			AI_PROVIDER_MODEL_ID: 'local-model',
			SOURCE_SEARCH_API_KEY: 'integration-test-search-key'
		}
	}
});
