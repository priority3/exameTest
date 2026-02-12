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
- Deployment guide: `docs/deploy.md`
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

This repo supports an "all Docker" single-server deployment:

- `docker-compose.prod.yml`: `caddy` (TLS) + `web` + `api` + `worker` + `postgres` + `redis`
- Reverse proxy shape: `https://DOMAIN/` (web) and `https://DOMAIN/api/*` (api)
- Browser requests use same-origin `/api`, so you don't need CORS in production
- DB migrations run via the one-off `migrate` service

### One-time server setup

Prereqs:

- Docker + docker compose plugin
- Ports `80` and `443` open
- DNS `A` record: `DOMAIN` -> your server public IP

1) Clone repo on the server (example):

```bash
mkdir -p /opt/exametest
cd /opt/exametest
git clone git@github.com:priority3/exameTest.git .
```

2) Create `.env` for `docker-compose.prod.yml`:

```bash
cp deploy/.env.prod.example .env
```

Edit `.env` and set:

- `DOMAIN`
- `POSTGRES_PASSWORD`
- `OPENAI_API_KEY` / `OPENAI_BASE_URL` (optional until you enable generation/grading)

3) Login to GHCR on the server (required if the repo/packages are private):

```bash
echo "<YOUR_GHCR_TOKEN>" | docker login ghcr.io -u "<YOUR_GITHUB_USERNAME>" --password-stdin
```

### Manual deploy (server)

From the repo root:

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml run --rm migrate
docker compose -f docker-compose.prod.yml up -d --remove-orphans
```

Or use the helper:

```bash
bash deploy/deploy.sh
```

### CI/CD (GitHub Actions -> SSH)

Workflow: `.github/workflows/deploy.yml`

Behavior:

- On every push to `main`:
  - Build & push images to GHCR (web/api/worker)
  - SSH into the server and run `bash deploy/deploy.sh`

Required GitHub secrets:

- `DEPLOY_HOST`: server IP / hostname
- `DEPLOY_USER`: ssh user (e.g. `root` or `ubuntu`)
- `DEPLOY_SSH_KEY`: private key (deploy key)
- `DEPLOY_PATH`: path of the repo checkout on the server (e.g. `/opt/exametest`)
- `GHCR_USERNAME`: github username that owns the token
- `GHCR_TOKEN`: PAT with `read:packages` (for `docker pull` on the server)
