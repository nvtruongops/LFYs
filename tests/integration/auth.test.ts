import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { auth } from '../../src/lib/server/auth/index';
import { db } from '../../src/lib/server/db';
import { user } from '../../src/lib/server/db/schema/auth';

const testEmails: string[] = [];

afterEach(async () => {
	for (const email of testEmails.splice(0)) {
		await db.delete(user).where(eq(user.email, email));
	}
});

describe('Better Auth PostgreSQL integration', () => {
	it('creates an account, resolves its session, and rejects an invalid session cookie', async () => {
		const email = `lfys-${crypto.randomUUID()}@example.test`;
		testEmails.push(email);

		const signUp = await auth.handler(
			new Request('http://localhost:5173/api/auth/sign-up/email', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name: 'Integration test', email, password: 'test-password-123' })
			})
		);

		expect(signUp.status).toBe(200);
		const signIn = await auth.handler(
			new Request('http://localhost:5173/api/auth/sign-in/email', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ email, password: 'test-password-123' })
			})
		);
		expect(signIn.status).toBe(200);

		const cookie = signUp.headers
			.getSetCookie()
			.map((value) => value.split(';', 1)[0])
			.find((value) => value.startsWith('better-auth.session_token='));
		expect(cookie).toBeDefined();

		const session = await auth.handler(
			new Request('http://localhost:5173/api/auth/get-session', {
				headers: { cookie: cookie! }
			})
		);
		expect((await session.json()).user.email).toBe(email);

		const invalidSession = await auth.handler(
			new Request('http://localhost:5173/api/auth/get-session', {
				headers: { cookie: 'better-auth.session_token=invalid' }
			})
		);
		expect(await invalidSession.json()).toBeNull();
	});
});
