# Roadmap / Post-MVP Backlog

This doc captures non-MVP follow-ups so we can continue iterating without losing context.

Repo: `.`

## Where we are now (scaffold status)

MVP is implemented as a working skeleton:

- Ingest (PASTE / MARKDOWN_UPLOAD) -> `sources` + `documents`
- Worker job `chunk_and_embed_source`:
  - chunks stored in `chunks`
  - embeddings stored in `chunk_embeddings` if `OPENAI_API_KEY` exists
- Worker job `generate_paper`:
  - requires `OPENAI_API_KEY`
  - generates questions with citations (chunk refs -> saved as `question_citations`)
- Worker job `grade_attempt`:
  - MCQ auto-grading
  - short-answer grading requires `OPENAI_API_KEY`
- UI pages:
  - `/` import + list
  - `/source/:id` preview + generate
  - `/paper/:id` preview + start attempt
  - `/attempt/:id` answer + submit
  - `/attempt/:id/result` grading + feedback

## Phase 1 (Finish MVP hardening)

### Reliability / correctness

- Add DB constraints / validations:
  - enforce MCQ options exactly 4 A-D (at write time)
  - ensure `question_citations` references chunks under the same `source_id`
- Improve chunking:
  - preserve heading hierarchy (`#`, `##`, ...) and carry it into chunk meta
  - add `charStart/charEnd` or `lineStart/lineEnd` for better evidence display
- Better progress reporting:
  - add `jobs` table (or `sources.meta` / `papers.meta`) to store active job ids + progress %
  - API: `GET /sources/:id` and `GET /papers/:id` return progress
- Improve grading determinism:
  - lower temperature on grading (already low)
  - add bounds checks (score must be numeric, <= maxScore)
  - add a second-pass regrade when confidence is low / output invalid

### Cost controls

- Add token/size limits:
  - per source max bytes
  - per document max bytes
  - per paper max questions
- Add caching by content hash:
  - if a `documents.content_hash` already chunked+embedded, reuse chunks/embeddings

### UX polish

- Show source processing state in UI (polling with backoff)
- Show paper generation state and job errors in UI (FAILED state)
- Evidence view:
  - on result page, allow expanding cited chunk text

## Phase 2 (URL article ingest)

### Parsing strategy

- Backend `ingest_source` job for `type=URL`
  - fetch HTML with proper headers/timeouts
  - extract readable content (readability / boilerplate removal)
  - store `documents.uri` as the URL
  - store original HTML snapshot (object storage recommended)
- Fallback UX:
  - if extraction quality is low, return error and suggest paste mode

### Compliance

- Respect `robots.txt` (optional but recommended)
- Store minimal data; support delete
- Clear disclaimer: user must have rights to import content

## Phase 3 (GitHub ingest: OAuth + path selection)

### Auth model

- Implement GitHub OAuth (or GitHub App if you need fine-grained/private repo access)
- Store:
  - user github identity mapping (or installation id)
  - repo + ref (branch/tag/sha)
  - selected paths and file filters

### Ingest details

- Use GitHub API to:
  - list repo tree
  - fetch file contents for selected paths
  - store each file as a `documents` row with:
    - `doc_type=GITHUB_FILE`
    - `uri=github://owner/repo@sha:path`
    - `meta={path, sha, repo, ref}`
- Limits:
  - file allowlist extensions: `.md .rst .txt .ts .js .py .go .java ...`
  - max file count + max total bytes

### UX

- Path picker (tree view)
- “Only docs” quick preset: `/README.md`, `/docs/**`

## Phase 4 (Retrieval: hybrid search + diversity sampling)

- Hybrid retrieval:
  - semantic: pgvector cosine distance
  - keyword: Postgres FTS (tsvector)
  - combine via weighted score
- Diversity:
  - penalize near-duplicate chunks in the same section
  - prefer covering multiple headings/files
- Reranking (optional):
  - small LLM or cross-encoder on top N candidates

## Phase 4.5 (LLM provider config)

- Support OpenAI-compatible providers beyond a single global `.env`:
  - per-user / per-workspace provider selection
  - store `{ provider, baseUrl, apiKeyRef, models }` (apiKey should be stored securely)
- Optional custom headers (some gateways require/encourage extra headers):
  - `OPENAI_DEFAULT_HEADERS` as JSON (or DB-stored)
  - examples: `HTTP-Referer`, `X-Title`

## Phase 5 (More question types)

- Multi-select MCQ
- True/False
- Fill-in-the-blank (cloze)
- Ordering / matching
- “Explain why this is wrong” (misconception detection)

Schema changes:

- `questions.type` enum extension
- `answers` to support different payloads

## Phase 6 (Code questions + sandbox judge)

### Minimum viable

- Support languages 1-2 first (e.g. JS/TS + Python)
- Each code question includes:
  - prompt + starter code
  - unit tests (hidden + public)
  - run command
- Grading:
  - score by test pass rate
  - LLM generates explanation based on failing tests + diff

### Safety

- Run in isolated environment (Docker/Firecracker)
- Strict limits:
  - CPU/mem/time
  - no outbound network
  - read-only FS except temp

## Phase 7 (Learning loop)

- Wrong-items -> spaced repetition schedule (SM-2 style or simpler)
- “Knowledge map” by tags:
  - auto-tag chunks and questions
  - show weak areas
- Generate “micro-quiz” from wrong-items only

## Phase 8 (Quality, safety, and trust)

- Question quality gates:
  - answerability check (LLM judge) before making paper READY
  - ambiguity detection (if multiple answers plausible -> regenerate)
- Cite-or-fail policy:
  - if citations missing or not relevant -> regenerate
- Moderation:
  - filter user content (prompt injection / malicious code)
  - sanitize HTML extraction

## Phase 9 (Multi-user, auth, billing)

- Replace `DEMO_USER_ID` with real auth:
  - email/password or OAuth providers
  - session/cookie
- Usage tracking:
  - tokens used per source/paper/attempt
  - rate limiting
- Billing (if you go there):
  - per paper generation
  - per grading

## Phase 10 (Ops)

- Observability:
  - structured logs for job runs
  - job retry dashboards (BullMQ UI or custom)
- Deployment:
  - dockerized API/worker/web
  - migrations in CI/CD
