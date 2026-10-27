# LFYs — LearnForYourself

LearnForYourself (LFYs) is a standalone learning app. Its initial product focus is Personal Learning: answer a learner's question first, then offer an optional learning journey after explicit consent, with private-by-default progress and source-linked lessons.

## Project status

The app implements PostgreSQL-backed authentication and Personal Learning consent/journey state, first-session background generation, snapshot sharing/forking, and an authenticated read-only MCP endpoint. Answer and lesson generation require a configured AI provider. Source-backed lesson generation requires `SOURCE_SEARCH_API_KEY` and fails closed when it is missing. Lessons cite retrieved allowlisted sources, but are not independently fact-checked.

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

2. Copy `.env.example` to `.env` and set a random `BETTER_AUTH_SECRET` of at least 32 characters.

   To configure the local model provider, run `bash scripts/configure-local-provider.sh` from the repository root. The script reads the API key without echoing it, stores it only in ignored `.env`, and makes one local smoke request without printing the response. Host-run development uses `http://localhost:20128/v1`; Compose uses `http://host.docker.internal:20128/v1`. Source search is disabled until `SOURCE_SEARCH_API_KEY` is configured.

3. Start PostgreSQL:

   ```sh
   docker compose up -d postgres
   ```

4. Apply the database migrations:

   ```sh
   pnpm db:migrate
   ```

5. Start the app and PostgreSQL together:

   ```sh
   docker compose up --build
   ```

    Or run the app outside Compose with `pnpm dev` after PostgreSQL is available and `DATABASE_URL` is configured.

The MCP endpoint is `POST /api/mcp` and uses the same Better Auth session cookie as the app. It currently exposes only `list_my_journeys` and `get_my_journey`; no MCP mutation tools are registered.

## Useful commands

| Command | Purpose |
|---|---|
| `pnpm dev` | Start the development server |
| `pnpm check` | Run Svelte and TypeScript checks |
| `pnpm test` | Run unit tests |
| `pnpm test:integration` | Run PostgreSQL-backed integration tests (start PostgreSQL and apply migrations first) |
| `pnpm build` | Create the production build |
| `node scripts/local-provider-smoke.mjs` | Verify the configured local model without printing its response or key |
| `pnpm db:generate` | Generate database migrations |
| `pnpm db:migrate` | Apply database migrations |
| `pnpm db:studio` | Open Drizzle Studio |

## Security and privacy

- Keep `.env` and real credentials out of Git; `.env.example` contains placeholders only.
- Local project documents under `docs/` are intentionally excluded from Git.
- Do not put private keys, certificates, database dumps, or user data in the repository.

## License

No license has been selected yet. All rights are reserved unless a license is added.
