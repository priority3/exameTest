# MVP Tech Spec (Plan A: TS Full Stack)

Goal: Turn "reading material" into an exam loop: ingest -> generate paper -> attempt -> grade -> review (with citations).

This MVP intentionally limits ingest to:

- Article: paste text / upload markdown (URL fetch optional later)
- GitHub: via OAuth + select repo + select paths (later)

## Repo Layout

```
.
  apps/
    web/                 # Next.js UI
    api/                 # Fastify HTTP API
    worker/              # BullMQ worker (background jobs)
  packages/
    shared/              # Zod schemas + shared types
    db/                  # Postgres pool + migrations runner
  db/
    migrations/          # SQL migrations (source of truth)
  docs/
    mvp.md               # This doc
  docker-compose.yml     # Postgres (pgvector) + Redis
  .env.example
```

## Data Model (Postgres)

Source of truth DDL:

- `db/migrations/001_init.sql`

Key concepts:

- `sources`: one import action (paste/upload/url/github)
- `documents`: normalized items under a source (e.g. each GitHub file becomes a document)
- `chunks`: RAG unit; keeps meta for traceability (path, heading, line range, etc.)
- `chunk_embeddings`: pgvector vectors for semantic search
- `papers/questions`: generated exam paper and questions
- `attempts/answers/grades`: taking the exam and grading output
- `wrong_items`: simple wrong-question notebook

Default vector dimension is 1536 (compatible with OpenAI `text-embedding-3-small`). If you change embedding model dim, you must migrate `chunk_embeddings.embedding`.

## API (Fastify)

MVP endpoints (implemented / current):

- `GET /sources`
- `POST /sources`
  - types: `PASTE | MARKDOWN_UPLOAD` (URL/GITHUB later)
  - returns: `{ id, status }`
  - side effect: enqueue `chunk_and_embed_source`
- `GET /sources/:id`
  - returns: status + counts (documents/chunks)
- `GET /sources/:id/preview`
  - returns: documents list + small text preview per document
- `POST /papers`
  - body: `{ sourceId, config }`
  - returns: `{ id, status }`
  - side effect: enqueue `generate_paper`
- `GET /papers/:id`
  - returns: paper without answer key
- `GET /papers/:id/answer-key` (debug/local only)
- `POST /attempts`
  - body: `{ paperId }`
  - returns: `{ id, status }`
- `GET /attempts/:id`
  - returns: attempt + paper + questions + current answers
- `POST /attempts/:id/submit`
  - side effect: enqueue grading job
- `GET /attempts/:id/result`
  - returns: final grades + feedback + citations
- `GET /wrong-items`

Implementation entrypoint:

- `apps/api/src/server.ts`

## Queue / Jobs (BullMQ + Redis)

Queue name: `exametest`

Job names (current):

- `chunk_and_embed_source` payload `{ sourceId }`
  - chunk documents -> (optional) embeddings -> mark source READY
- `generate_paper` payload `{ paperId }`
  - questions (each w/ citations) -> save to DB -> mark paper READY
- `grade_attempt` payload `{ attemptId }`
  - MCQ: compare answer
  - Short answer: LLM rubric grading (+ citations)

Current scaffold:

- `apps/worker/src/worker.ts`

## Shared Schemas (Zod)

Shared API payload + LLM JSON output schemas:

- `packages/shared/src/schemas.ts`

Design rules:

- Every question MUST include `citations[]` referencing `chunkId`s.
- Grading MUST be rubric-based; if evidence is insufficient, lower confidence rather than hallucinating.

## Local Dev

Infra required:

- Postgres 16 with pgvector extension
- Redis 7

Recommended: Docker Desktop / OrbStack / Colima, then:

```bash
cp .env.example .env
pnpm install
pnpm infra:up
pnpm db:migrate
pnpm dev
```

Optional: OpenAI-compatible third party providers:

- set `OPENAI_BASE_URL` in `.env`
  - recommended: `https://your-provider.example` (no path)
  - the worker auto-appends `/v1` if the URL has no path, to match common OpenAI-compatible gateways
- set `OPENAI_API_KEY`
- set `OPENAI_CHAT_MODEL` / `OPENAI_EMBEDDING_MODEL` accordingly

Notes on compatibility:

- Some OpenAI-compatible providers support `GET /v1/models` but do NOT implement `POST /v1/embeddings`.
  - In MVP, embeddings are **best-effort**: ingest still completes and sources can become READY without embeddings.
- Some providers error if `temperature` is sent to `POST /v1/responses`.
  - The worker will retry with a minimal payload when it detects this.

If you don't use Docker, install via Homebrew (macOS):

```bash
brew install postgresql@16 redis
brew services start postgresql@16
brew services start redis
```

Then set `.env` and run:

```bash
pnpm install
pnpm db:migrate
pnpm dev
```
