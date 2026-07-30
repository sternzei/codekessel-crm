# QCG Sales-Automation — Production-Readiness Assessment

**Date:** 2026-07-27 (addendum 2026-07-30)
**Scope:** `sales-automation/` (Next.js 16 App Router + TypeScript, Drizzle ORM + PostgreSQL w/ RLS, multi-tenant, pnpm).

## 2026-07-30 product decision

- **WhatsApp Cloud API (Meta) is parked** until Business verification / credentials land.
- Interim UX: tasks use **WhatsApp öffnen** (wa.me). Cloud sends are refused when
  adapters are mock — no fake “versendet”.
- Production env fail-fast added in `src/lib/env.ts` (`APP_BASE_URL` HTTPS,
  secret strength, `TRUST_PROXY`, `STORAGE_DRIVER=s3` or
  `ALLOW_LOCAL_STORAGE_IN_PROD=true`).
- Remaining non-WhatsApp P1s: Redis rate limits, Resend timeouts, structured
  logs/Sentry, branded `error.tsx`, CI Playwright — track separately.

**Historical note:** The original body below was a read-only audit (2026-07-27).
Several P0s listed there (storage abstraction, health, Dockerfile, inbound
tenant scope) have since been implemented; prefer current code + this addendum
over the frozen P0 table when they conflict.

## Phase 0 operational addendum

- Alert on structured log event `outbox_stale_sending_detected`.
- The default ambiguity threshold is 15 minutes; override with
  `OUTBOX_STALE_SENDING_MINUTES` (minimum 5).
- Never retry a `sending` row automatically. Reconcile the message ID,
  recipient and provider logs/webhooks first; the provider may have accepted
  the send before local persistence failed. Correct status only from evidence.
- Migration 0013 adds PostgreSQL enum value `manager`. Recovery is a forward
  corrective migration; do not manually delete or rewrite the enum value.
- Migration 0014 changes the creator foreign key to `ON DELETE SET NULL`, so
  user offboarding preserves outbound history.
- 0013 and 0014 are separate forward migrations. If deployment is interrupted
  between them, creator deletion remains temporarily blocked by `NO ACTION`;
  resume the migration runner through 0014 before offboarding users.

---

## State of the tree (checks I ran)

| Check | Command | Result |
|-------|---------|--------|
| Type check | `npx tsc --noEmit` | ✅ **Pass** — 0 errors |
| Lint | `pnpm lint` (eslint) | ✅ **Pass** — 0 warnings/errors |
| Unit tests | `pnpm test:unit` | ✅ **247 / 247 pass** (node:test, ~1.7s) |
| Production build | `pnpm build` (Next 16 / Turbopack) | ✅ **Success** (exit 0) with **1 warning** |

**Build warning:** Turbopack NFT tracing pulled `next.config.ts` into the trace for `src/app/api/documents/[id]/download/route.ts` — caused by `fs`/`path` filesystem ops in that route. Cosmetic today, but it is the same code smell that underlies **P0-1** (local-disk file serving). Route map: 18 routes, all dynamic (`ƒ`) except `/_not-found` — expected for a session/RLS app.

**Verified hardening (sound):**
- `worker.ts` — atomic claim via `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED) RETURNING`, stale-claim recovery at 10 min, escalate-once via conditional `UPDATE … RETURNING`. Correct.
- `tokens/service.ts` — `markTokenUsed`/`completeTaskViaToken` burn atomically (`WHERE used_at IS NULL … RETURNING`) before side effects; external actions call burn-first. Correct.
- `file-sniff.ts` + `uploadDocuments` — magic-byte sniff, sniff must equal claimed MIME, random on-disk names, size cap, validate-before-burn. Correct.
- `client-ip.ts` — `x-forwarded-for` only honored behind `TRUST_PROXY`, uses the **last** entry. Correct (but see **P1-3** for the fail-closed side effect).
- RLS — every tenant table has `ENABLE ROW LEVEL SECURITY` + `tenant_isolation` policy (0001, plus `contact_notes` 0003, `import_runs` 0007, `message_deliveries` 0010). Append-only `activity_log`/`consent_records` have split SELECT/INSERT policies and revoked UPDATE/DELETE. `auth_lookup_user` is the single deliberate `SECURITY DEFINER` exception. Sound.

---

## P0 — Hard blockers for production

### P0-1 · Documents & uploads are stored on the local filesystem (data loss / unreachable files)
- **Locations:**
  - `src/modules/participants/external-actions.ts` → `uploadDocuments` writes to `var/uploads/` via `writeFile` (L319-335).
  - `src/modules/documents/generate.ts` writes generated/signed PDFs under `var/` (`PROVIDER_CITY` path, L135).
  - `src/app/api/documents/[id]/download/route.ts` serves them with `readFile(path.resolve(process.cwd(), servePath))` (L32-43).
  - `.gitignore` ignores `/var/` (runtime dir).
- **Why it matters:** These are legally-relevant DSGVO/AZAV artifacts (participant uploads, signed consent PDFs). Local disk is **ephemeral on containers/serverless and not shared across replicas**. Any redeploy, autoscale, or second instance means uploads are lost or 404 on download. This is the single biggest launch risk.
- **Recommendation:** Introduce a storage abstraction (`putObject`/`getObject`) backed by S3/GCS/Azure Blob (or, if deploying to a single always-on VM, an explicitly-provisioned persistent volume with backups). Store object keys in `documents.file_path` / `signed_file_path`; stream from the store in the download route. Keep the magic-byte validation as-is.
- **Effort:** **L**

### P0-2 · Cross-tenant write in `applyInboundReceipt` (tenant-isolation break)
- **Location:** `src/modules/messaging/deliveries.ts` L80-92 (`applyInboundReceipt`), invoked by `reconcileDeliveryEvents` from `src/app/api/webhooks/whatsapp/route.ts` on the **owner connection** (`getSystemDb`, RLS bypassed by design).
- **Why it matters:** The update matches participants by `phone_normalized` **with no tenant filter**:
  ```
  update participants set whatsapp_window_expires_at = …
  where phone_normalized = <normalized>
  ```
  Running on the RLS-bypassing owner role, an inbound message reopens the 24h WhatsApp window for **every** participant sharing that phone number across **all** tenants. `applyStatusReceipt` is fine (keyed on the globally-unique `provider_message_id`); only the inbound path lacks a tenant boundary. Impact is bounded today (only writes a timestamp; requires the same number to exist in ≥2 tenants; the webhook is inert until `WHATSAPP_APP_SECRET` is set), so it is latent — but it is a genuine cross-tenant mutation and **must be fixed before WhatsApp goes live**.
- **Recommendation:** Resolve the owning tenant from delivery context before writing — e.g. look up the most recent outbound `message_deliveries` row to that recipient/number to get its `tenant_id`, then scope the participant update to `(tenant_id, phone_normalized)`. If no prior outbound exists, skip (there is nothing to reconcile). Add a regression test asserting a two-tenant same-phone scenario only touches the correct tenant.
- **Effort:** **S–M**

### P0-3 · No deploy artifacts + unsupervised background worker (core automation silently stops)
- **Locations:** repo root — no `Dockerfile`, no `Procfile`, no `.github/` CI; `src/jobs/worker.ts` runs only via `pnpm jobs:dev`/`jobs:once`; no `/api/health` route exists (only 3 API routes total).
- **Why it matters:** The reminder/escalation worker is a **separate long-lived process**. If it isn't running (or dies and isn't restarted), reminders stop firing, tasks stop escalating, and reminder-triggered magic-link re-issue stops — the product's entire value proposition (automated follow-up) fails **silently**, with nothing to alert on. There is also no readiness probe for the web tier and no supervised migration step.
- **Recommendation:**
  1. Add container/process definitions for **both** the web app and the worker (e.g. two services in a Dockerfile/compose or a `Procfile` with `web:` and `worker:`), with a restart policy.
  2. Add a lightweight `GET /api/health` (DB `select 1` + build info) and a worker heartbeat (write `last_tick_at` somewhere, or log a machine-parseable heartbeat) so a monitor can detect a dead worker.
  3. Wire a deploy step that runs `pnpm db:migrate` (using `MIGRATION_DATABASE_URL`) before the web tier starts.
- **Effort:** **M**

---

## P1 — Should fix before launch

### P1-1 · Rate limiting & external-action throttle are in-memory / per-process
- **Locations:** `src/lib/rate-limit.ts` (module-level `Map`), `src/modules/tokens/throttle.ts` + `request-throttle.ts`, used by `auth/actions.ts` login and the `/t/*` external actions.
- **Why it matters:** State lives in one Node process. Behind ≥2 instances the login brute-force cap and the magic-link submission budgets are per-instance, so an attacker gets `N × limit` and buckets reset on every deploy. The code comments already flag this ("move to Redis/Postgres").
- **Recommendation:** Back the limiter with Redis (or a Postgres table with a TTL sweep) keyed the same way. Keep the pure limiter interface for tests.
- **Effort:** **M**

### P1-2 · Global login lockout when `TRUST_PROXY` is unset (self-DoS footgun)
- **Location:** `src/lib/client-ip.ts` `rateLimitClientKey` → returns `"untrusted"` for **all** callers when `TRUST_PROXY` is not set; consumed by `auth/actions.ts` (`login:untrusted`).
- **Why it matters:** Fail-closed sharing is correct against spoofing, but it means **10 failed logins from anyone in 5 min locks out every user** (they all share the `login:untrusted` bucket). In production you must run behind a proxy and set `TRUST_PROXY=true`; if that step is missed, login is trivially DoS-able.
- **Recommendation:** Make `TRUST_PROXY=true` a documented, enforced production requirement (assert it in `env.ts` when `NODE_ENV=production`, or fail readiness). Consider also keying the login limiter on the submitted email in addition to IP so one IP can't lock everyone.
- **Effort:** **S**

### P1-3 · No timeout on outbound WhatsApp/Resend provider calls
- **Location:** `src/modules/messaging/adapters.ts` — `WhatsAppCloudAdapter.send` (L74) and `ResendEmailAdapter.send` (L129) call `fetch` with **no `AbortController`/timeout**, unlike `OpenRegisterProvider` which uses a 15s timeout (`openregister.ts` L16, L313-346).
- **Why it matters:** A hung provider connection blocks the reminder worker's per-task loop (and any request path that sends), stalling the queue indefinitely. Graceful degradation is otherwise good (mock mode, `ok:false` on non-2xx).
- **Recommendation:** Add the same `AbortController` + timeout (e.g. 10–15s) to both adapter `fetch` calls; treat abort as a normal `ok:false` so the worker's retry/backoff handles it.
- **Effort:** **S**

### P1-4 · Observability: unstructured logs, no monitoring/alerting/error tracking
- **Locations:** `src/lib/logger.ts` (a `console.log` string line, not JSON), no Sentry/OTel, no request-id correlation, no metrics.
- **Why it matters:** Production incident triage (failed sends, worker stalls, RLS errors) depends on greppable structured logs and alerts. Current logs are human-readable strings with no severity routing or aggregation-friendly shape; there is no error-tracking hook.
- **Recommendation:** Emit JSON lines (`{ts, level, msg, ...fields}`), add an error-tracking transport (Sentry or equivalent) in the layout/error boundary and in the worker's catch blocks, and add basic counters (reminders sent, escalations, send failures). The PII-minimal convention is good — enforce it with a typed `fields` allowlist.
- **Effort:** **M**

### P1-5 · No CI pipeline
- **Location:** no `.github/workflows` (or other CI config) present.
- **Why it matters:** 247 unit tests + Playwright e2e exist but nothing runs them on push/PR, so regressions (incl. the RLS/tenant invariants) can land unnoticed.
- **Recommendation:** Add CI that runs `pnpm install`, `tsc --noEmit`, `pnpm lint`, `pnpm test:unit` on every PR, and the Playwright suite against an ephemeral Postgres (compose) on main. Gate merges on green.
- **Effort:** **S–M**

### P1-6 · No app-level error/loading UI boundaries
- **Locations:** none of `error.tsx`, `global-error.tsx`, `not-found.tsx`, `loading.tsx` exist under `src/app/**` (only Next's built-in `/_not-found`).
- **Why it matters:** An unhandled server error in any route renders the raw Next error screen (and can leak a stack in dev-style builds); there are no Suspense fallbacks for slow DB queries and no branded 404. For a client-facing `/t/[token]` participant flow this is a poor, confusing experience.
- **Recommendation:** Add `global-error.tsx` + per-segment `error.tsx` (with a "try again" and a support hint), a `not-found.tsx`, and `loading.tsx` for the data-heavy `/pipeline`, `/tasks`, and `/t/[token]` segments. Localize via `messages/de.json`.
- **Effort:** **M**

### P1-7 · `env.ts` gaps: localhost default for `APP_BASE_URL`, weak secret guardrail, unvalidated operational vars
- **Location:** `src/lib/env.ts`.
- **Why it matters:**
  - `APP_BASE_URL` **defaults to `http://localhost:3000`** — a prod deploy that forgets to set it will mint magic links pointing at localhost (broken participant links) with no startup failure.
  - Secrets require only `min(16)`; the `.env.example` ships `dev-only-…-change-me` values. The only guard is `AUTH_SECRET !== TOKEN_SECRET`; a short/committed secret passes.
  - `TRUST_PROXY`, `APTITUDE_TEST_BASE_URL`, `PROVIDER_CITY`, `RESEND_API_KEY/RESEND_FROM_EMAIL` are read via bare `process.env` and not validated/documented centrally.
- **Recommendation:** In production (`NODE_ENV=production`) require `APP_BASE_URL` (no localhost default, must be https), raise secret `min` to 32, and reject the known dev placeholder values. Add the operational vars to the schema (even if optional) for one source of truth. Fail fast at startup.
- **Effort:** **S**

### P1-8 · `outbound_messages` schema is ahead of migrations (owned by the excluded WhatsApp track — verify, don't implement)
- **Location:** `src/db/schema/outbound-messages.ts` + `src/db/schema/index.ts` export it, but **no migration** defines `outbound_messages` (grep of `drizzle/` finds none), and therefore no RLS policy for it yet.
- **Why it matters:** Type-check/build pass against the schema, but the table doesn't exist in the DB and, when the migration is added, it **must** get an RLS `tenant_isolation` policy like every other tenant table or it becomes a cross-tenant hole. This belongs to the excluded approval workstream — flagged here only as a launch **gate**, not proposed work.
- **Recommendation:** Ensure the messaging-approval track's migration enables RLS + policy on `outbound_messages` and runs before launch. Do not ship the schema export without the migration.
- **Effort:** **S** (owned by the other track)

---

## P2 — Post-launch / nice-to-have

### P2-1 · Connection pooling for scale
- `db/client.ts` uses `postgres(max: 10)` and caches on `globalThis` only when `NODE_ENV !== production`; `system-client.ts` uses `max: 3`; `worker.ts` opens its own `max: 3` pool (duplicating `system-client`). Fine for a single always-on Node server, but N replicas × 10 + worker can exhaust Postgres `max_connections`, and serverless would open a fresh pool per cold start. **Rec:** front the DB with PgBouncer (transaction pooling; note `prepare:false` is already set, which is pooler-friendly) and/or lower `max`; have the worker import `system-client` instead of a third pool. **Effort:** S–M.

### P2-2 · CSP still allows `'unsafe-inline'` for scripts/styles
- `next.config.ts` documents this (App Router inline bootstrap + inline `style` attrs). Headers are otherwise strong (HSTS in prod, `frame-ancestors 'none'`, nosniff, Referrer-Policy, Permissions-Policy). **Rec:** move to per-request nonces via a proxy/middleware and drop `'unsafe-inline'` for `script-src`. **Effort:** M.

### P2-3 · i18n: `messages/en.json` is a stub; locale hardcoded to `de`
- `i18n/request.ts` always returns `de`; `en.json` has only `app`/`nav`/`auth` while `de.json` is complete. Correct for a German-first MVP, but any future EN switch will throw on missing keys. **Rec:** either remove `en.json` until EN is real, or complete it and add a fallback. **Effort:** S.

### P2-4 · Build-trace warning / `fs` in a route
- The Turbopack NFT warning stems from filesystem access in the documents download route; resolving **P0-1** (object storage) removes it. Until then, harmless. **Effort:** — (folded into P0-1).

### P2-5 · Migration-history drift note
- `drizzle/0011` contains idempotent guards for databases that applied a superseded `0009_curious_arclight` tag, and uses `ALTER TYPE … ADD VALUE IF NOT EXISTS`. Handled correctly, but indicates prior history renaming. **Rec:** confirm the `drizzle/meta` journal matches all environments before the first prod migrate; keep enum `ADD VALUE` statements isolated (they can't run in the same txn that uses the new value — currently fine). **Effort:** S.

### P2-6 · Worker resilience niceties
- The worker retries (3 attempts, 5-min backoff), recovers stale claims, and dedups follow-ups — solid. Missing: graceful shutdown on SIGTERM in `--loop` mode (the loop never ends / never `sql.end()`), and a cap/jitter on the poll under sustained failure. **Rec:** add a SIGTERM handler that stops the loop and closes the pool; add small jitter to `POLL_INTERVAL_MS`. **Effort:** S.

---

## Dimension summary

- **Deployment & config:** `env.ts` fails fast and covers the critical secrets, but defaults `APP_BASE_URL` to localhost and under-specifies operational vars (P1-7). No Dockerfile/Procfile/CI, no health endpoint, unsupervised worker, manual migrations (P0-3, P1-5). Pooling OK for single-node, needs PgBouncer for scale (P2-1). Build/tsc/lint/tests all green.
- **Security:** authz is real (signed session role checks; admin gate on register import; RLS on every tenant table; magic-link burn-first + single-use + supersede; strong headers; webhook HMAC + verify-token; zod on inputs; upload magic-byte sniffing). **One cross-tenant write** in `applyInboundReceipt` (P0-2). In-memory rate limiting and the global login-lockout footgun need addressing (P1-1, P1-2). `outbound_messages` RLS gate (P1-8).
- **Reliability & observability:** good queue semantics and idempotency; graceful mock degradation; OpenRegister has timeouts but **messaging adapters don't** (P1-3). Logging is unstructured, no alerting/error tracking, no health probe (P0-3, P1-4).
- **Data integrity & performance:** migrations are additive/nullable (safe); good indexing (`participants_pipeline_idx`, `tasks_active_dedup_idx`, unique `magic_link_tokens_hash_idx`, `reminder_jobs_due_idx`); aggregations are SQL-side, list is paginated, no N+1 in hot paths; transaction boundaries correct. Main risk is durable **file** storage (P0-1), not DB.
- **Testing & CI:** 247 unit tests pass and are well-targeted (tokens, RLS-adjacent helpers, webhook parsing, throttles); e2e phase specs exist. No CI to run any of it (P1-5); consider an explicit cross-tenant RLS integration test.
- **Frontend:** clean (no `console` noise outside seed/logger), accessible-ish server components, German i18n complete. Missing error/loading/not-found boundaries (P1-6); `en.json` stub (P2-3).

---

## Prioritized checklist

**P0 (block launch)**
1. Durable object storage for uploads + generated/signed PDFs — **L**
2. Fix cross-tenant write in `applyInboundReceipt` (before WhatsApp goes live) — **S–M**
3. Deploy artifacts + supervised worker + `/api/health` + migration step — **M**

**P1 (before launch)**
1. Shared (Redis/Postgres) rate limiting & throttle — **M**
2. Enforce `TRUST_PROXY` in prod / avoid global login lockout — **S**
3. Timeouts on WhatsApp + Resend `fetch` — **S**
4. Structured logs + error tracking + basic metrics — **M**
5. CI (tsc/lint/unit on PR, e2e on main) — **S–M**
6. `error.tsx`/`global-error.tsx`/`not-found.tsx`/`loading.tsx` — **M**
7. `env.ts` prod hardening (APP_BASE_URL, secret strength, operational vars) — **S**
8. Verify `outbound_messages` migration + RLS (excluded track) — **S**

**P2 (post-launch)**
1. PgBouncer / pool sizing / worker reuses `system-client` — **S–M**
2. CSP nonces (drop `'unsafe-inline'`) — **M**
3. Complete or remove `en.json` — **S**
4. Remove `fs` build-trace warning (folded into P0-1) — —
5. Confirm migration journal parity across envs — **S**
6. Worker SIGTERM graceful shutdown + poll jitter — **S**

---

## Deploy runbook

Status of the three P0 blockers (all addressed in this change set):

- **P0-1 (durable storage) — done.** Uploads + generated/signed PDFs now go
  through `src/modules/storage` (`StorageAdapter`: `put`/`get`/`delete`). Driver
  is selected by `STORAGE_DRIVER` (`local` default, `s3` for AWS S3 / Cloudflare
  R2 / MinIO). Stored values are opaque storage keys (legacy `var/…` paths still
  resolve). The `fs` build-trace warning (P2-4) is gone.
- **P0-2 (cross-tenant write) — done.** `applyInboundReceipt` resolves the
  owning tenant from the most recent outbound `message_deliveries` row for the
  number, then scopes the window reopen to that exact `(tenant, participant)`.
  Fails closed if no owning tenant is found.
- **P0-3 (deploy artifacts) — done.** `Dockerfile` (multi-stage, Next
  `output: "standalone"`), `.dockerignore`, `docker-compose.yml` (db + web +
  worker), `Procfile`, `GET /api/health`, hardened worker (SIGTERM/SIGINT
  graceful shutdown, heartbeat, poll jitter), and `.github/workflows/ci.yml`.

Status of the P1 findings closed since:

- **P1-1 (in-memory throttles) — done.** Login and `/t` buckets live in
  `rate_limit_buckets` (`RATE_LIMIT_DRIVER=postgres`, the production default),
  so replicas share one budget. The worker sweeps expired rows each tick.
- **P1-2 (global login lockout) — done.** Failed logins now count against a
  per-account+client budget (10 / 5 min) *and*, only when the client IP is
  knowable, a per-IP budget across all accounts (30 / 5 min) that keeps password
  spraying capped. With `TRUST_PROXY` unset the per-IP budget is skipped rather
  than collapsing every caller into one bucket.
- **P1-3 (no provider timeout) — done.** Outbound WhatsApp/Resend calls abort
  after `PROVIDER_REQUEST_TIMEOUT_MS` (15 s) via `AbortController`.
- **P1-5 (no CI) — done.** `.github/workflows/ci.yml` runs lint, typecheck, unit
  tests, migrate + seed against a Postgres service, and the Playwright suite.
- **P1-6 (error/loading UI) — done.** `global-error.tsx` plus per-segment
  `error.tsx` / `not-found.tsx` for the internal app and the public `/t/[token]`
  flow, localized through `messages/de.json`. Only `/t/[token]` gets a
  `loading.tsx`: a route-group `loading.tsx` over `(internal)` wraps every page
  in a Suspense boundary, and in production builds that boundary swallows the
  refreshed tree a server action returns — the consultant then keeps seeing the
  pre-action state until a manual reload (caught by `phase2-3`). Internal pages
  are fast and dynamic, so the fallback bought little; do not re-add it without
  verifying post-action revalidation against `pnpm start`.
- **P1-7 (`env.ts` gaps) — done.** `APP_BASE_URL` must be https in production
  (localhost only allowed for the single-VM demo via
  `ALLOW_LOCAL_STORAGE_IN_PROD`), secrets require 32+ chars and reject the
  shipped dev placeholders, and `TRUST_PROXY` / `RESEND_API_KEY` /
  `RESEND_FROM_EMAIL` are now part of the central schema.

### Required production environment

Validated centrally in `src/lib/env.ts`; see `.env.example` for the full list.

| Var | Required | Notes |
|-----|----------|-------|
| `DATABASE_URL` | yes | App runtime, RLS-enforced `qcg_app` role. |
| `MIGRATION_DATABASE_URL` | yes (migrate + worker) | Owner role; bypasses RLS by design. |
| `AUTH_SECRET`, `TOKEN_SECRET` | yes | Must differ; ≥32 chars in prod (use `openssl rand -base64 32`). |
| `APP_BASE_URL` | yes in prod | Public HTTPS origin; magic links are minted from it. |
| `STORAGE_DRIVER` | yes | `local` or `s3`. **Use `s3` in multi-instance prod.** |
| `S3_BUCKET` | if `s3` | Enforced at startup when `STORAGE_DRIVER=s3`. |
| `S3_REGION`/`S3_ENDPOINT`/`S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY`/`S3_FORCE_PATH_STYLE`/`S3_KEY_PREFIX` | if `s3` | `S3_ENDPOINT` for R2/MinIO; `S3_FORCE_PATH_STYLE=true` for MinIO. |
| `ALLOW_LOCAL_STORAGE_IN_PROD` | if local in prod | `true` only with a persistent volume (compose: `qcg-uploads`). Also relaxes localhost `APP_BASE_URL` for single-VM demos. |
| `TRUST_PROXY` | yes in prod | Must be `true` behind a proxy (enforced by `env.ts`). |
| WhatsApp / Resend / OpenRegister vars | optional | Adapters stay demo-safe until set. |

Full matrix also under **Deploy env matrix** below.

### Migration step (run before the web tier serves)

```
pnpm db:migrate          # local (drizzle-kit migrate, uses MIGRATION_DATABASE_URL)
# containers run the equivalent automatically:
node_modules/.bin/drizzle-kit migrate
```

Migration `0001` provisions the `qcg_app` role + grants + RLS policies. In prod,
override its dev password (`ALTER ROLE qcg_app PASSWORD …` / secret manager).

### Deploy env matrix (required in `NODE_ENV=production`)

| Var | Required | Notes |
|-----|----------|-------|
| `APP_BASE_URL` | yes | Public **HTTPS** origin (magic links). Localhost/`http://` only allowed with single-VM escape hatch below. |
| `AUTH_SECRET` / `TOKEN_SECRET` | yes | ≥32 chars, must differ, no placeholders (`openssl rand -base64 32`). |
| `TRUST_PROXY` | yes | `true` behind nginx/Cloudflare/load balancer. |
| `STORAGE_DRIVER` | yes | Prefer `s3` in multi-replica prod. |
| `S3_BUCKET` (+ region/keys) | if `s3` | Enforced at startup. |
| `ALLOW_LOCAL_STORAGE_IN_PROD` | if local disk | `true` only on a **single always-on VM** with a persistent volume for uploads/PDFs. |
| `RESEND_API_KEY` / `RESEND_FROM_EMAIL` | optional | Email goes live when both set; otherwise mock. |
| WhatsApp Cloud vars | parked | Interim UI uses wa.me until Meta credentials land. |

See also [`.env.example`](../.env.example).

### Run the full stack (prod-like, local)

```
docker compose --profile app up -d --build   # db + web + worker
curl -fsS localhost:3000/api/health           # -> {"status":"ok"}
```

- `web` runs migrations then `node server.js`; `worker` runs
  `tsx src/jobs/worker.ts --loop`; both `restart: unless-stopped`.
- Compose app profile mounts named volume `qcg-uploads` → `/app/var` and sets
  `ALLOW_LOCAL_STORAGE_IN_PROD=true` so PDFs survive container restarts.
- `web` has a Docker healthcheck on `/api/health`; `worker` waits until web is healthy.
- For multi-replica prod: set `STORAGE_DRIVER=s3` and inject `S3_*` into web/worker
  (do **not** rely on the local volume).
- `docker compose up -d` (no profile) still starts only `db` (keeps
  `pnpm db:reset` fast and unblocks local dev).

### PaaS (Heroku-style)

`Procfile` defines `release` (migrate), `web` (`node server.js`), and `worker`.
Point the worker dyno/process at the `worker` entry so reminders/escalations run
under supervision — a dead worker silently stops all automated follow-up.

### Monitoring hooks

- Web readiness: `GET /api/health` (200 ok / 503 on DB failure; unauthenticated,
  info-light).
- Worker liveness: a `worker heartbeat` log line (~once/minute) plus per-tick
  `worker tick` lines — alert if no heartbeat within a few minutes.
