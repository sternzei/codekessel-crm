# syntax=docker/dockerfile:1

# Multi-stage production image. It serves BOTH tiers from one artifact:
#   * web    → the Next.js standalone server  (node server.js)
#   * worker → the reminder/escalation loop    (node dist/worker.mjs --loop)
#   * migrate→ drizzle-kit migrate             (one-shot, before web starts)
# The web tier uses Next's `output: "standalone"` bundle and the worker is
# pre-compiled at build time, so the runtime image carries neither the sources
# nor the dev toolchain (no eslint / typescript / tailwind / playwright).

ARG NODE_VERSION=22-alpine

# --- deps: install all dependencies (frozen lockfile) -----------------------
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# --- deps-prod: runtime dependencies only -----------------------------------
# What the worker (bundled, `--packages=external`) and `drizzle-kit migrate`
# need at runtime. The build toolchain never reaches the final image.
FROM node:${NODE_VERSION} AS deps-prod
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

# --- build: compile the Next.js standalone bundle + the worker --------------
FROM node:${NODE_VERSION} AS build
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# `next build` imports src/lib/env.ts (which parses env at module load), so give
# it schema-valid placeholders. These NEVER reach the running container — the
# real values are injected at runtime by compose / the platform.
ENV NODE_ENV=production
ENV DATABASE_URL=postgres://build:build@localhost:5432/build
ENV MIGRATION_DATABASE_URL=postgres://build:build@localhost:5432/build
ENV AUTH_SECRET=build-only-placeholder-secret-value
ENV TOKEN_SECRET=build-only-different-placeholder-secret
ENV LEGAL_PROVIDER_NAME=build-only
ENV LEGAL_PROVIDER_ADDRESS=build-only
ENV LEGAL_PROVIDER_EMAIL=build-only@example.com
RUN pnpm build

# --- runner: minimal runtime image ------------------------------------------
FROM node:${NODE_VERSION} AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# 1) Next standalone server (self-contained web tier).
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public

# 2) Runtime deps for the worker and migrations. The standalone server brings
#    its own trimmed node_modules; this overlay is a superset of it.
COPY --from=deps-prod /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/templates ./templates
# PDF text fonts — without these, every document with a non-Windows-1252
# character in it fails to render (see src/modules/documents/fonts.ts).
COPY --from=build /app/assets ./assets
COPY --from=build /app/content ./content
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/drizzle.config.ts ./drizzle.config.ts

EXPOSE 3000

# Default: run the web server. compose/Procfile override the command for the
# worker and the one-shot migration.
CMD ["node", "server.js"]
