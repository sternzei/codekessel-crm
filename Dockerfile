# syntax=docker/dockerfile:1

# Multi-stage production image. It serves BOTH tiers from one artifact:
#   * web    → the Next.js standalone server  (node server.js)
#   * worker → the reminder/escalation loop    (tsx src/jobs/worker.ts --loop)
#   * migrate→ drizzle-kit migrate             (one-shot, before web starts)
# The web tier uses Next's `output: "standalone"` bundle; the worker + migrate
# steps run TypeScript directly via tsx, so the runtime image also carries the
# full node_modules + source (small trade-off for a single coherent image).

ARG NODE_VERSION=22-alpine

# --- deps: install all dependencies (frozen lockfile) -----------------------
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# --- build: compile the Next.js standalone bundle ---------------------------
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
RUN pnpm build

# --- runner: minimal-ish runtime image --------------------------------------
FROM node:${NODE_VERSION} AS runner
WORKDIR /app
RUN corepack enable
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# 1) Next standalone server (self-contained web tier).
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public

# 2) Toolchain + sources for the worker and migrations (not part of the Next
#    build). The full node_modules is a superset of the standalone's trimmed
#    one, so the standalone server keeps working after this overlay.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/src ./src
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/templates ./templates
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY --from=build /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=build /app/next.config.ts ./next.config.ts

EXPOSE 3000

# Default: run the web server. compose/Procfile override the command for the
# worker and the one-shot migration.
CMD ["node", "server.js"]
