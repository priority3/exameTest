# syntax=docker/dockerfile:1.6

# Monorepo multi-target Dockerfile.
# Targets:
# - web
# - api
# - worker

FROM node:22-slim AS base
WORKDIR /app

# pnpm via corepack (bundled with Node)
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS deps

# Only copy the minimal set of files required for dependency resolution to
# maximize layer cache hits.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/db/package.json packages/db/package.json

RUN pnpm install --frozen-lockfile

FROM deps AS repo
COPY . .

# ----------------------------
# web
# ----------------------------
FROM repo AS web
ENV NODE_ENV=production
EXPOSE 3000
RUN pnpm -C apps/web build
CMD ["pnpm", "-C", "apps/web", "start", "-p", "3000"]

# ----------------------------
# api
# ----------------------------
FROM repo AS api
ENV NODE_ENV=production
EXPOSE 4000
CMD ["pnpm", "-C", "apps/api", "start"]

# ----------------------------
# worker
# ----------------------------
FROM repo AS worker
ENV NODE_ENV=production
CMD ["pnpm", "-C", "apps/worker", "start"]

