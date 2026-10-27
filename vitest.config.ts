import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [sveltekit()],
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    env: {
      APP_ORIGIN: 'http://localhost:5173',
		DATABASE_URL: 'postgresql://lfys:lfys_dev_only@localhost:5432/lfys',
      BETTER_AUTH_URL: 'http://localhost:5173',
      BETTER_AUTH_SECRET: 'development-test-secret-32-characters'
    }
  }
});
