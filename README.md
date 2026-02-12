# exameTest

AI-powered exam platform (MVP): Import study materials → AI generates exam papers → Take exams online → AI grades answers → Get reference answers with detailed explanations and cited evidence.

## Repo layout

- `apps/web`: Next.js UI
- `apps/api`: Fastify HTTP API
- `apps/worker`: BullMQ worker (background jobs: chunk/embed, exam generation, grading)
- `packages/shared`: Zod schemas + shared types/constants
- `packages/db`: Postgres client + migrations runner
- `db/migrations`: SQL migrations (DDL source of truth)

## Docs

- MVP tech spec: `docs/mvp.md`
- Post-MVP roadmap: `docs/roadmap.md`
- Transcript: `docs/conversation-2026-02-11.md`

## Development

### Prereqs

- Node.js >= 20
- pnpm (the root `package.json` specifies `packageManager`)
- Postgres 16 + pgvector extension
- Redis 7

### 1) Configure env

```bash
cp .env.example .env
```

Required (local dev):

- `DATABASE_URL`
- `REDIS_URL`
- `NEXT_PUBLIC_API_BASE_URL` (default `http://localhost:4000`)

Optional (needed for exam generation / essay grading):

- `OPENAI_API_KEY`
- `OPENAI_BASE_URL` (OpenAI-compatible provider base URL)
- `OPENAI_CHAT_MODEL`
- `OPENAI_EMBEDDING_MODEL` (embeddings are best-effort; the provider may not implement it)

Notes:

- If `OPENAI_BASE_URL` has no path, the worker will auto-append `/v1` (common OpenAI-compatible gateway layout).

### 2) Infra via Docker (recommended)

Start Postgres + Redis:

```bash
pnpm infra:up
```

Run migrations:

```bash
pnpm db:migrate
```

Start dev (web + api + worker):

```bash
pnpm dev
```

Ports:

- Web: http://localhost:3000
- API: http://localhost:4000
- API health: http://localhost:4000/health

### 3) Infra without Docker (macOS/Homebrew)

```bash
brew install postgresql@16 redis
brew services start postgresql@16
brew services start redis
```

Then set `DATABASE_URL` + `REDIS_URL` in `.env`, and run:

```bash
pnpm install
pnpm db:migrate
pnpm dev
```

### Useful commands

Infra:

```bash
pnpm infra:up
pnpm infra:down
pnpm infra:logs
```

Typecheck:

```bash
pnpm typecheck
```

Run a single service:

```bash
pnpm -C apps/web dev
pnpm -C apps/api dev
pnpm -C apps/worker dev
```

### Troubleshooting

- Port in use:

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN
lsof -nP -iTCP:4000 -sTCP:LISTEN
```

- Reset local DB volume (DANGEROUS: deletes local data):

```bash
docker compose down -v
pnpm infra:up
pnpm db:migrate
```

## Deployment

This MVP currently runs as three Node processes (web/api/worker) + Postgres + Redis.
There are no production Dockerfiles yet (only `docker-compose.yml` for infra).

### Option A: VM / process manager (recommended for now)

Prereqs on the server:

- Node.js >= 20 + pnpm
- Postgres 16 + pgvector
- Redis 7
- A `.env` file with production values

Steps:

1) Install deps:

```bash
pnpm install --frozen-lockfile
```

2) Run migrations (run once per deploy):

```bash
pnpm db:migrate
```

3) Build web:

```bash
pnpm -C apps/web build
```

4) Start processes (use systemd/pm2/supervisord in real deploys):

Web:

```bash
pnpm -C apps/web start
```

API (currently runs TypeScript via `tsx` runtime):

```bash
pnpm -C apps/api exec tsx src/server.ts
```

Worker (currently runs TypeScript via `tsx` runtime):

```bash
pnpm -C apps/worker exec tsx src/worker.ts
```

Notes:

- `apps/api` and `apps/worker` load the repo-root `.env` explicitly.
- Make sure `NEXT_PUBLIC_API_BASE_URL` points to the public API URL (not `localhost`) for browsers.
- CORS is currently configured for local dev only. For real deployments, update the allowlist in `apps/api/src/server.ts`.
- For a stricter production setup, add build+start scripts for api/worker (compile to JS) and run via `node`.

### Option B: Containers (planned)

Planned improvements:

- Add Dockerfiles for `apps/web`, `apps/api`, `apps/worker`
- Add a production compose file that runs:
  - `web` + `api` + `worker`
  - `postgres` (or use managed DB)
  - `redis` (or use managed Redis)

Track this in: `docs/roadmap.md`
