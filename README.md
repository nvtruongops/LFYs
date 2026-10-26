# LFYs — LearnForYourself

LearnForYourself (LFYs) is a standalone learning app. Its initial product focus is Personal Learning: answer a learner's question first, then offer an optional learning journey with private-by-default progress and source-verified lessons.

## Project status

The repository currently contains the SvelteKit application scaffold, PostgreSQL/Drizzle setup, Better Auth integration, and a generated initial auth migration. The migration has not yet been applied to a running database. Personal Learning journeys and MCP tools are not implemented yet.

## Technology

- SvelteKit and Svelte 5 with the Node.js adapter
- TypeScript and pnpm
- PostgreSQL, Drizzle ORM, and pg-boss
- Better Auth
- Vitest and Playwright
- Docker Compose for local development

The application is a single deployable Node.js app. The UI, server routes, authentication, domain logic, background jobs, and MCP endpoint share one configuration and authorization boundary.

## Requirements

- Node.js `24.22.1`
- pnpm `12.15.0`
- Docker Compose (for the local PostgreSQL and app stack)

## Local development

1. Install dependencies:

   ```sh
   pnpm install
   ```

2. Copy `.env.example` to `.env` and set a random `BETTER_AUTH_SECRET` of at least 32 characters. Add provider API keys only when using those integrations.

3. Start the app and PostgreSQL together:

   ```sh
   docker compose up --build
   ```

   Or run the app outside Compose with `pnpm dev` after PostgreSQL is available and `DATABASE_URL` is configured.

## Useful commands

| Command | Purpose |
|---|---|
| `pnpm dev` | Start the development server |
| `pnpm check` | Run Svelte and TypeScript checks |
| `pnpm test` | Run unit tests |
| `pnpm build` | Create the production build |
| `pnpm db:generate` | Generate database migrations |
| `pnpm db:migrate` | Apply database migrations |
| `pnpm db:studio` | Open Drizzle Studio |

## Security and privacy

- Keep `.env` and real credentials out of Git; `.env.example` contains placeholders only.
- Local project documents under `docs/` are intentionally excluded from Git.
- Do not put private keys, certificates, database dumps, or user data in the repository.

## License

No license has been selected yet. All rights are reserved unless a license is added.
