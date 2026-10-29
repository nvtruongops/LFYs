import { expect, test } from '@playwright/test';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const emails: string[] = [];

test.afterAll(async () => {
	for (const email of emails) await pool.query('DELETE FROM "user" WHERE email = $1', [email]);
	await pool.end();
});

async function signUp(page: import('@playwright/test').Page) {
	const email = `learner-${crypto.randomUUID()}@example.test`;
	emails.push(email);
	await page.goto('/sign-in');
	await page.getByRole('button', { name: 'Create an account' }).click();
	await page.getByLabel('Name').fill('E2E Learner');
	await page.getByLabel('Email').fill(email);
	await page.getByLabel('Password').fill('e2e-test-password-1234');
	await page.getByRole('button', { name: 'Create account' }).click();
	await expect(page).toHaveURL(/\/learning$/);
	return email;
}

async function ask(page: import('@playwright/test').Page, goal: string) {
	await page.getByLabel('Your question').fill('How do batteries store energy?');
	await page.getByLabel('What would you like to learn?').fill(goal);
	await page.getByRole('button', { name: 'Answer my question' }).click();
	await expect(page.getByRole('heading', { name: 'Your answer' })).toBeVisible();
}

test('declining the offer creates no journey', async ({ page }) => {
	await signUp(page);
	await ask(page, 'Learn battery chemistry');
	await page.getByRole('button', { name: 'Not now' }).click();
	await expect(page.getByText('No journey was created.')).toBeVisible();
	await expect(page.getByText(/Session 1 status:/)).toHaveCount(0);
});

test('consent generates only one ready session', async ({ page }) => {
	await signUp(page);
	await ask(page, 'Learn battery chemistry');
	await page.getByRole('button', { name: 'Accept and create journey' }).click();
	await expect.poll(async () => {
		await page.reload();
		return page.getByText(/Session 1 status:/).textContent();
	}, { timeout: 30_000 }).toContain('ready');
	await expect(page.getByRole('heading', { name: 'Battery basics' })).toBeVisible();
	await expect(page.getByText(/Session 2 status:/)).toHaveCount(0);
});

test('source failure stays visible and does not create session 2', async ({ page }) => {
	await signUp(page);
	await ask(page, 'Trigger source failure');
	await page.getByRole('button', { name: 'Accept and create journey' }).click();
	await expect.poll(async () => {
		await page.reload();
		return page.getByText(/Session 1 status:/).textContent();
	}, { timeout: 30_000 }).toContain('failed');
	await expect(page.getByText(/We could not generate this lesson from available sources/)).toBeVisible();
	await expect(page.getByText(/Session 2 status:/)).toHaveCount(0);
});

test('review is optional at the target boundary and extension does not create a session', async ({ page }) => {
	await signUp(page);
	await ask(page, 'Learn battery chemistry');
	await page.getByLabel('Study sessions').selectOption('1');
	await page.getByRole('button', { name: 'Accept and create journey' }).click();
	await expect.poll(async () => {
		await page.reload();
		return page.getByText(/Session 1 status:/).textContent();
	}, { timeout: 30_000 }).toContain('ready');

	await expect(page.getByText('Review this session before continuing, if you wish.')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Continue to next session' })).toHaveCount(0);
	await page.getByLabel('Extend to').selectOption('7');
	await page.getByRole('button', { name: 'Extend journey' }).click();
	await expect(page.getByText('Journey target extended to 7 sessions.')).toBeVisible();
	await expect(page.getByText(/Session 2 status:/)).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Continue to next session' })).toBeVisible();
});

test('lesson chat does not progress; explicit continuation creates one next session', async ({ page }) => {
	await signUp(page);
	await ask(page, 'Learn battery chemistry');
	await page.getByRole('button', { name: 'Accept and create journey' }).click();
	await expect.poll(async () => {
		await page.reload();
		return page.getByText(/Session 1 status:/).textContent();
	}, { timeout: 30_000 }).toContain('ready');

	await page.getByLabel('Your question about this lesson').fill('How do ions move through the electrolyte?');
	await page.getByRole('button', { name: 'Ask about lesson' }).click();
	await expect(page.getByText('A battery stores energy chemically.', { exact: true })).toBeVisible();
	await expect(page.getByText(/Session 2 status:/)).toHaveCount(0);

	await page.getByRole('button', { name: 'Continue to next session' }).click();
	await expect(page.getByText('Session 2 has been queued.')).toBeVisible();
	await expect.poll(async () => {
		await page.reload();
		return page.getByText(/Session 2 status:/).textContent();
	}, { timeout: 30_000 }).toContain('ready');
	await expect(page.getByText(/Session 3 status:/)).toHaveCount(0);
	await expect(page.getByText('Next focus: How do ions move through the electrolyte?')).toBeVisible();
});

test('owner can retry failed session 1 without creating a duplicate', async ({ page }) => {
	await signUp(page);
	await ask(page, 'Trigger source failure');
	await page.getByRole('button', { name: 'Accept and create journey' }).click();
	await expect.poll(async () => {
		await page.reload();
		return page.getByText(/Session 1 status:/).textContent();
	}, { timeout: 30_000 }).toContain('failed');

	await page.getByLabel('Optional public source URL').fill('https://example.org/battery');
	await page.getByRole('button', { name: 'Retry session 1' }).click();
	await expect(page.getByText('Session 1 has been queued for another attempt.')).toBeVisible();
	await expect.poll(async () => {
		await page.reload();
		return page.getByText(/Session 1 status:/).textContent();
	}, { timeout: 30_000 }).toContain('ready');
	await expect(page.getByText(/Session 2 status:/)).toHaveCount(0);
});
