# Deployment (All Docker, Single Domain + /api)

This guide deploys the whole stack on a single server using Docker Compose:

- `caddy` (TLS + reverse proxy)
- `web` (Next.js)
- `api` (Fastify + SSE)
- `worker` (BullMQ worker)
- `postgres` (pgvector)
- `redis` (BullMQ queue + realtime pub/sub)

Reverse proxy shape (same origin):

- `https://YOUR_DOMAIN/` -> `web`
- `https://YOUR_DOMAIN/api/*` -> `api` (prefix stripped by reverse proxy)

## 0) Prereqs

- A Linux server with Docker + `docker compose` plugin installed
- Ports `80` and `443` open to the internet
- DNS `A` record: `YOUR_DOMAIN` -> server public IP
- A GitHub repo checkout on the server (used by the deploy script + compose file)

## 1) Server: clone the repo

Example:

```bash
mkdir -p /opt/exametest
cd /opt/exametest
git clone git@github.com:priority3/exameTest.git .
```

## 2) Server: create production `.env`

This `.env` is used by `docker-compose.prod.yml` for variable substitution.

From the repo root on the server:

```bash
cp deploy/.env.prod.example .env
```

Edit `.env` and set at least:

- `DOMAIN=yourdomain.com`
- `POSTGRES_PASSWORD=change_me_to_a_strong_password`

Optional (needed for paper generation / short-answer grading):

- `OPENAI_API_KEY=...`
- `OPENAI_BASE_URL=...` (OpenAI-compatible provider base URL)
- `OPENAI_CHAT_MODEL=...`
- `OPENAI_EMBEDDING_MODEL=...`

## 3) Server: login to GHCR (if images are private)

If your GHCR packages are private, the server must authenticate to pull images.

```bash
echo "<YOUR_GHCR_TOKEN>" | docker login ghcr.io -u "<YOUR_GITHUB_USERNAME>" --password-stdin
```

Token requirements (PAT):

- `read:packages` (minimum)

## 4) First deploy (manual)

From the repo root on the server:

```bash
bash deploy/deploy.sh
```

What it does:

1. `docker compose -f docker-compose.prod.yml pull`
2. `docker compose -f docker-compose.prod.yml run --rm migrate`
3. `docker compose -f docker-compose.prod.yml up -d --remove-orphans`

## 5) Validate

- Web: `https://YOUR_DOMAIN/`
- API health: `https://YOUR_DOMAIN/api/health`

Check containers:

```bash
docker compose -f docker-compose.prod.yml ps
```

Logs:

```bash
docker compose -f docker-compose.prod.yml logs -f --tail=200 caddy
docker compose -f docker-compose.prod.yml logs -f --tail=200 api
docker compose -f docker-compose.prod.yml logs -f --tail=200 worker
docker compose -f docker-compose.prod.yml logs -f --tail=200 web
```

## 6) CI/CD (GitHub Actions -> SSH)

Workflow file:

- `.github/workflows/deploy.yml`

Behavior:

- On every push to `main`:
  - Build & push `web/api/worker` images to GHCR
  - SSH into the server and run `bash deploy/deploy.sh`

### 6.1 GitHub Secrets required

Add these secrets in GitHub:

- `DEPLOY_HOST`: server IP/hostname
- `DEPLOY_USER`: ssh username (e.g. `ubuntu` / `root`)
- `DEPLOY_SSH_KEY`: private key for SSH (deploy key)
- `DEPLOY_PATH`: server repo path (e.g. `/opt/exametest`)
- `GHCR_USERNAME`: github username used for GHCR login on the server
- `GHCR_TOKEN`: PAT (must allow pulling packages, typically `read:packages`)

### 6.2 Recommended: create a dedicated deploy SSH key

Generate locally:

```bash
ssh-keygen -t ed25519 -C "exametest-deploy" -f ./exametest_deploy_key
```

Then:

- Add `exametest_deploy_key.pub` to the server's `~/.ssh/authorized_keys`
- Put the content of `exametest_deploy_key` (private key) into the GitHub secret `DEPLOY_SSH_KEY`

## 7) Common issues

### 7.1 SSE not updating (grading/generation looks stuck)

This deployment uses same-origin `/api`, so CORS should not be involved.

Check:

- `docker compose logs -f api` (is API running?)
- `docker compose logs -f worker` (is worker consuming jobs?)
- `docker compose logs -f redis` (is redis healthy?)

### 7.2 TLS certificate not issuing

Make sure:

- `DOMAIN` resolves to the server public IP
- Ports `80` and `443` are reachable from the internet
- `caddy` logs show ACME success:

```bash
docker compose -f docker-compose.prod.yml logs -f --tail=200 caddy
```

