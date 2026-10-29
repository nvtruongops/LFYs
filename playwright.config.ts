import { defineConfig } from '@playwright/test';

const baseURL = 'http://127.0.0.1:5187';
const e2eEnv = {
	APP_ORIGIN: baseURL,
	ORIGIN: baseURL,
	PORT: '5187',
	PROTOCOL_HEADER: 'x-forwarded-proto',
	DATABASE_URL: 'postgresql://lfys:lfys_dev_only@localhost:5432/lfys_e2e',
	BETTER_AUTH_URL: baseURL,
	BETTER_AUTH_SECRET: 'playwright-test-secret-with-at-least-32-characters',
	AI_PROVIDER_API_KEY: 'playwright-test-key',
	AI_PROVIDER_BASE_URL: 'http://127.0.0.1:20128/v1',
	AI_PROVIDER_MODEL_ID: 'playwright-test-model',
	SOURCE_SEARCH_API_KEY: 'playwright-test-search-key',
	NODE_OPTIONS: '--import=./tests/e2e/provider-mocks.mjs'
};

Object.assign(process.env, e2eEnv);

export default defineConfig({
	testDir: './tests/e2e',
	globalSetup: './tests/e2e/global-setup.mjs',
	fullyParallel: false,
	workers: 1,
	timeout: 90_000,
	use: { baseURL, trace: 'retain-on-failure', extraHTTPHeaders: { 'x-forwarded-proto': 'http' } },
	webServer: {
		command: 'npm run db:migrate && npm run build && npm run start',
		url: `${baseURL}/sign-in`,
		reuseExistingServer: false,
		timeout: 60_000,
		stdout: 'pipe',
		stderr: 'pipe',
		env: e2eEnv
	}
});
