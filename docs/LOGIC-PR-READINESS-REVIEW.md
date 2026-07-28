# Logic & PR-Readiness Review — `514629c` (WhatsApp approval-before-send + P0 hardening)

**Reviewer:** Independent code-reviewer agent  
**Date:** 2026-07-28  
**Commit:** `514629c feat: WhatsApp approval-before-send gate + P0 production hardening`  
**Base:** `origin/main` (`7bdf3e3` — full: `7bdf3e328ea2aed2ac338e2cd4a0227f4d4aa9f4`)  
**Changed files:** 49 in `origin/main...HEAD` (24 new, 25 modified) + 1 untracked file (this report, not part of the commit)  
**Mode:** Read-only logic review. No source files modified, no commits, no pushes.

---

## 1. Verdict

### CONDITIONAL GO

The three P0 blockers from the prior audit (`PRODUCTION-READINESS.md`) are resolved:
- P0-1 (durable storage) — done, `StorageAdapter` abstraction with local + S3 driver.
- P0-2 (cross-tenant `applyInboundReceipt`) — fixed, now resolves owning tenant from outbound delivery history and fails closed.
- P0-3 (no deploy artifacts) — done, Dockerfile / compose / Procfile / CI / health route / worker hardening.

The approval gate itself is architecturally sound: `adapter.send()` is called in exactly **one** code location in the entire codebase (`approveAndDispatch` in `outbox.ts`), every system send path enqueues instead of dispatching, and the server action is session-guarded + tenant-scoped.

One **P1 security/correctness issue** must be fixed before the branch can be pushed and opened as a PR: a **concurrent-approve race condition** in `approveAndDispatch` that can send the same WhatsApp message twice (double-dispatch) on a double-click or concurrent approval request. A further **P1 CI correctness issue** means the workflow may fail on first push. The remaining findings are P2 and do not block shipping.

---

## 2. Verification Runs

| Check | Command | Result |
|-------|---------|--------|
| TypeScript | `npx tsc --noEmit` | **Pass** — 0 errors |
| Lint | `pnpm lint` (ESLint) | **Pass** — 0 warnings/errors |
| Unit tests | `pnpm test:unit` | **Pass — 281/281** (node:test, ~2 s) |
| Migration chain | snapshot prevId chain validation | **Pass** — 0→1→…→12 unbroken |
| Adapter.send call sites | `rg "adapter\.send"` in `src/` | **Exactly 1** — only `outbox.ts:180` |
| `enqueueTaskMessage` call sites | All callers verified | 3 systems paths; all enqueue, none dispatch |
| `outbound_messages` RLS | `drizzle/0012_early_shiva.sql` | `ENABLE ROW LEVEL SECURITY` + `tenant_isolation` policy present |

---

## 3. Findings

### P1 — Must fix before push/PR

---

#### P1-1 · Race condition in `approveAndDispatch` — concurrent approve can double-dispatch

**Severity:** P1 — can send the same WhatsApp message twice to a recipient  
**File:** `src/modules/messaging/outbox.ts` lines 134–201  
**Exact lines at fault:** the first UPDATE (lines 147–154)

**Failure scenario:**

`approveAndDispatch` runs inside a `withTenant` Postgres transaction (READ COMMITTED isolation, the default). The approve flow is:

```
1. SELECT * WHERE id=? AND tenantId=?   -- no row lock
2. if (!canApprove(row.status)) return  -- app-layer check on stale read
3. UPDATE SET status='sending'           -- WHERE clause is only `WHERE id=?`
4. adapter.send(...)                     -- HTTP call to WhatsApp
5. UPDATE SET status='sent'/'failed'     -- second update, also only by id
```

With two simultaneous approve requests (double-click, or two browser tabs):

- TxA reads `pending_approval` → passes `canApprove`  
- TxB reads `pending_approval` (TxA not yet committed) → also passes `canApprove`  
- TxA executes UPDATE (step 3), acquires row lock  
- TxB's UPDATE blocks on the row lock  
- TxA calls `adapter.send()` → WhatsApp receives message #1; TxA commits (`status='sent'`)  
- TxB's UPDATE unblocks, executes `SET status='sending' WHERE id=?` — the WHERE has no status guard, so it **overwrites `sent` back to `sending`**  
- TxB calls `adapter.send()` → WhatsApp receives message #2 — **double send**

This is reachable by any internal user with access to the Postausgang who double-clicks Approve, or if two users approve simultaneously.

**Why it matters:** A participant receives the same WhatsApp message twice (potentially with the same magic link). Each send is also metered by Meta. For templates it may violate Meta's rate policies.

**Concrete fix:** Collapse the SELECT + app-layer check into a single atomic conditional UPDATE:

```typescript
// Replace the SELECT + separate UPDATE with:
const [locked] = await tx
  .update(outboundMessages)
  .set({
    status: "sending",
    approvedByUserId: params.approvedByUserId,
    approvedAt: now,
  })
  .where(
    and(
      eq(outboundMessages.id, params.messageId),
      eq(outboundMessages.tenantId, params.tenantId),
      eq(outboundMessages.status, "pending_approval"),  // atomic guard
    ),
  )
  .returning({ id: outboundMessages.id, taskId: outboundMessages.taskId, ... });

if (!locked) {
  // Row didn't exist, or was already handled by a concurrent approve.
  return "not_found"; // or "not_pending" — differentiate if needed by a prior SELECT
}
```

The `AND status = 'pending_approval'` in the UPDATE's WHERE clause is the key: Postgres evaluates it at the time the UPDATE acquires the row lock, **after** any concurrent transaction commits. The second concurrent request gets an empty RETURNING and returns `"not_pending"` without calling the adapter.

**Test needed:** An integration test (real DB or a fake that simulates lock contention) that races two concurrent `approveAndDispatch` calls on the same message and asserts `adapter.send` was called exactly once.

---

#### P1-2 · CI workflow: `pnpm/action-setup@v4` has no `version:` and `packageManager` is absent from `package.json`

**Severity:** P1 — CI may fail on first push  
**File:** `.github/workflows/ci.yml` lines 10–11

`pnpm/action-setup@v4` requires either a `version:` parameter or a `packageManager` field in `package.json` to determine which pnpm version to install. Neither is present:

```yaml
# ci.yml (current — may fail)
- name: Setup pnpm
  uses: pnpm/action-setup@v4          # no version:
# package.json: no "packageManager" field
```

Without either, v4 of the action defaults to the latest stable pnpm at CI run time, which is non-deterministic. Worse, some v4 patch releases made `version:` mandatory and will fail the CI step entirely.

**Fix:**

```yaml
- name: Setup pnpm
  uses: pnpm/action-setup@v4
  with:
    version: 10                    # pin to the major in use
```

Or add `"packageManager": "pnpm@10.x.y"` to `package.json` (preferred for reproducibility).

---

### P2 — Post-merge / quality

---

#### P2-1 · `approved` is a dead state — state machine and dispatch code are inconsistent

**File:** `src/modules/messaging/outbound-status.ts` (TRANSITIONS) vs `outbox.ts` (approveAndDispatch)

The state machine defines:
```
pending_approval → approved (via user action)
approved         → sending  (via dispatch)
```

The actual dispatch code does:
```
pending_approval → sending  (directly, in one step)
```

`canTransition('pending_approval', 'sending')` would return `false` — yet this is the transition the code takes. The `approved` state can never be set by the current flow; `canCancel(status === 'approved')` is therefore unreachable.

**Why it matters:** Tests for `canTransition` would give false confidence; the state machine definition is misleading to future maintainers.

**Fix (option A — align state machine to implementation):**

```typescript
// outbound-status.ts: remove `approved` intermediate
const TRANSITIONS = {
  pending_approval: ["sending", "rejected", "cancelled"],
  sending: ["sent", "failed"],
  ...
};
```

**Fix (option B — align implementation to state machine, add two-step approve):**

Have `approveAndDispatch` set `status='approved'` and return, then have a separate worker or a second UI action call a new `dispatchApproved` function. This enables a future cancel-after-approve window.

---

#### P2-2 · `updated_at` never updated on status-change UPDATEs

**File:** `src/modules/messaging/outbox.ts` — `approveAndDispatch` (L147, L194), `rejectOutboundMessage` (L263), `cancelOutboundMessage` (L319)

None of these UPDATE calls include `updatedAt: new Date()`. The column stays at `created_at` value for the lifetime of the row, making it useless for determining when a status transition occurred (e.g., how long a message waited for approval).

**Fix:** Add `updatedAt: new Date()` to every UPDATE's `.set({ ... })` in `outbox.ts`.

---

#### P2-3 · `cancelMessage` server action is implemented but not wired to any UI

**File:** `src/modules/outbox/actions.ts` (cancelMessage), `src/app/(internal)/outbox/page.tsx`

The page's `BANNER_KEYS` includes `"cancelled"` and `"not_cancellable"`, but the page renders no Cancel button. Users cannot cancel a pending message from the UI.

**Fix:** Either add a Cancel button to the outbox card, or document that cancel is intentionally accessible only via API/programmatic path.

---

#### P2-4 · `adapter.send()` is called inside an open DB transaction

**File:** `src/modules/messaging/outbox.ts:180`

`withTenant` wraps the entire `approveAndDispatch` call in a `db.transaction()`. The `adapter.send()` HTTP call therefore happens while a Postgres connection is held open. If `adapter.send()` succeeds (WhatsApp accepts the message) but a *subsequent* DB operation inside the same transaction fails (e.g., `recordOutboundDelivery` INSERT), the transaction rolls back. The row returns to `pending_approval`; the next approve call sends the message a second time.

The probability is low (the follow-up ops are simple non-conflicting writes), but the failure mode is a silent double-send with no error surfaced to the approver.

**Recommended fix (post-MVP):** Commit `status='sending'` in its own transaction, then call `adapter.send()` outside any DB transaction, then open a second short transaction to record the result. This is a standard outbox/saga pattern.

---

#### P2-5 · Procfile `worker` command requires `tsx` (devDependency) — breaks Heroku-style deploys in production

**File:** `Procfile:3`

```
worker: node --import tsx src/jobs/worker.ts --loop
```

`tsx` is listed in `devDependencies`. Heroku's Node.js buildpack prunes devDependencies when `NODE_ENV=production`, so the worker dyno will crash with `Cannot find package 'tsx'`.

The Docker image is **not** affected (the `deps` stage runs `pnpm install --frozen-lockfile` without `--prod`, so all deps including tsx are in the image).

**Fix:**

Option A — move `tsx` to `dependencies` (simplest, adds ~15 MB to prod image):
```json
"dependencies": { "tsx": "^4.19.4", ... }
```

Option B — use `pnpm build` to emit a compiled `dist/jobs/worker.js` and reference that in the Procfile:
```
worker: node dist/jobs/worker.js --loop
```

---

#### P2-6 · docker-compose.yml does not forward `TRUST_PROXY` to the web service

**File:** `docker-compose.yml` web service environment block

If the stack is deployed behind a reverse proxy (nginx, Caddy, AWS ALB) and the operator omits `TRUST_PROXY=true` from their `.env`, the `client-ip.ts` `rateLimitClientKey` returns `"untrusted"` for every request. All login attempts then share the `login:untrusted` rate-limit bucket — 10 failed logins from *anyone* locks out all users. This was documented as P1-2 in `PRODUCTION-READINESS.md`.

**Fix:** Add a pass-through for the variable:

```yaml
environment:
  # ... existing vars ...
  TRUST_PROXY: ${TRUST_PROXY:-}
```

---

## 4. Approval-Gate Send-Path Matrix

Every code path that could result in a message reaching a WhatsApp or email provider:

| Entry point | File | Before this commit | After this commit | Gated? |
|---|---|---|---|---|
| Routing engine (task creation) | `routing/engine.ts:dispatchExternal` | `adapter.send()` | `enqueueTaskMessage()` | **YES** |
| Reminder worker (due job) | `jobs/worker.ts:sendExternalReminder` | `adapter.send()` | `enqueueTaskMessage()` | **YES** |
| Manual internal action | `tasks/actions.ts:sendTaskWhatsApp` | `adapter.send()` | `enqueueTaskMessage()` | **YES** |
| Human approve (Postausgang) | `outbox/actions.ts:approveMessage` → `outbox.ts:approveAndDispatch` | — (new) | `adapter.send()` | **IS THE GATE** |
| Click-to-chat deep link | `tasks/actions.ts:buildWhatsAppClickToChat` | deep-link, no API | deep-link, no API | Not applicable (no API dispatch) |
| Internal `createReminderCallTask` | `jobs/worker.ts` | creates internal task | creates internal task | Not a send path |

**Result: `adapter.send()` appears in exactly one location** (`outbox.ts:180`), reachable only through `approveAndDispatch`, which is callable only from the session-guarded `approveMessage` server action. No send path bypasses the gate.

---

## 5. Tenant-Safety Matrix — New Owner/System Connection Queries

| Function | File | Connection | Tenant scope | Assessment |
|---|---|---|---|---|
| `enqueueTaskMessage` | `outbox.ts` | Caller's connection (owner in worker, app-role in server actions) | `tenantId` set on the INSERT | Correct |
| `approveAndDispatch` | `outbox.ts` | App-role (via `withTenant`) | `AND tenantId=?` in SELECT + RLS on UPDATE | Correct |
| `rejectOutboundMessage` | `outbox.ts` | App-role (via `withTenant`) | `AND tenantId=?` in SELECT + RLS on UPDATE | Correct |
| `cancelOutboundMessage` | `outbox.ts` | App-role (via `withTenant`) | `AND tenantId=?` in SELECT + RLS on UPDATE | Correct |
| `listPendingMessages` | `outbox.ts` | App-role (via `withTenant`) | RLS filters by `app.tenant_id` | Correct |
| `resolveInboundOwner` | `deliveries.ts:82` | Owner (webhook, no tenant) | Resolves tenant from prior outbound history | Correct (fixed from prior P0-2) |
| `applyInboundReceipt` | `deliveries.ts:113` | Owner (webhook) | Scopes UPDATE to `(id=participant AND tenantId=owner.tenantId)` | Correct — fails closed if no owner |
| Worker: `sendExternalReminder` | `worker.ts:172` | Owner (MIGRATION_DATABASE_URL) | `task.tenantId` explicit on enqueue | Correct |
| Worker: `createReminderCallTask` | `worker.ts:213` | Owner | `task.tenantId` explicit on INSERT | Correct |
| Worker: `escalateOverdueTasks` | `worker.ts:265` | Owner | `task.tenantId` used on all writes | Correct |

All `outbound_messages` writes from the worker use `db` (owner connection, bypasses RLS by design, consistent with `message_deliveries` and `reminder_jobs`). All approval/reject/cancel actions use `withTenant` (app-role, RLS-enforced), consistent with the security model.

---

## 6. Migration / Schema Review (`0012_early_shiva.sql`)

| Check | Finding |
|---|---|
| Snapshot chain | 0→1→2→…→12 prevId chain verified unbroken |
| Journal entry | idx 12 present, matching tag `0012_early_shiva` |
| Table creation | `outbound_messages` with all required columns |
| Foreign keys | `tenant_id→tenants`, `task_id→tasks`, `approved_by_user_id→users`, `rejected_by_user_id→users` |
| Indexes | `(tenant_id, status)` composite + `(tenant_id, task_id)` — correct for pending-list and task drilldown queries |
| RLS | `ENABLE ROW LEVEL SECURITY` + `tenant_isolation` policy `FOR ALL TO qcg_app` — matches sibling tables |
| Missing | No `updated_at` auto-update trigger (consistent with other tables — all update `updated_at` manually in app code, but outbox functions don't, see P2-2) |
| Missing | No unique constraint or partial index to prevent duplicate `pending_approval` rows for the same `(tenant_id, task_id)` — multiple enqueues for one task are currently allowed (may be intentional: retry queuing). If not intentional, add `CREATE UNIQUE INDEX ... ON outbound_messages (tenant_id, task_id) WHERE status = 'pending_approval'`. |
| Enum rollback | `CREATE TYPE outbound_message_status` cannot be rolled back easily (Postgres enum mutations are DDL). Migration is additive-only — acceptable; but a rollback script that removes the type would need `DROP TYPE outbound_message_status CASCADE`. |
| Grants | Relies on `ALTER DEFAULT PRIVILEGES` from `0001` — works on a fresh DB; on a DB that predates `0001` being applied, the `qcg_app` role may lack SELECT/INSERT/UPDATE. Confirm `0001` ran on all target environments first. |

---

## 7. Deployment / Container / CI Review

### Dockerfile

| Check | Result |
|---|---|
| Multi-stage build (deps → build → runner) | Correct |
| Build-time placeholders for env vars | Present — these are documented, non-secret placeholders that never reach the container |
| `output: "standalone"` used | Yes — `next.config.ts` sets it |
| Node.js standalone bundle + full `node_modules` overlay | Correct — `COPY --from=deps /app/node_modules` overlays the trimmed standalone bundle |
| Worker source + drizzle config in runner | Copied from `build` stage — correct |
| `templates/` directory included | Copied — required for PDF generation |
| Non-root user | **Missing** — the image runs as root. Container security best practice is `RUN adduser -D -u 1001 node && USER node` |
| `EXPOSE 3000` | Present |
| Default CMD `["node", "server.js"]` | Correct for web tier |

### docker-compose.yml

| Check | Result |
|---|---|
| `db` service with healthcheck | Correct |
| `web` depends_on `db` (service_healthy) | Correct |
| `worker` depends_on `web` (service_started) | Correct (ensures migrations ran before worker starts) |
| Migration step in `web` command | `drizzle-kit migrate && node server.js` — correct |
| `profiles: ["app"]` for web + worker | Correct — `docker compose up -d` (no profile) starts only `db` |
| Optional vars (WHATSAPP_*, RESEND_*, TRUST_PROXY) | Not forwarded — must be passed via host `.env` or `-e` flags. See P2-6 for `TRUST_PROXY`. |
| Volume for local storage | **Missing** — with `STORAGE_DRIVER=local`, the `var/` directory inside the container is ephemeral. A `docker compose down` or container restart destroys uploads. Acceptable only if S3 is used in production; add a comment warning to this effect. |

### Procfile

```
release: node_modules/.bin/drizzle-kit migrate
web:     node server.js
worker:  node --import tsx src/jobs/worker.ts --loop
```

| Check | Result |
|---|---|
| `release` runs migrations before web starts | Correct (Heroku/Render run release before web/worker) |
| `web` runs standalone bundle | Correct |
| `worker` uses `tsx` | See P2-5 — breaks on Heroku with devDep pruning |
| Migration URL | Uses `MIGRATION_DATABASE_URL` (owner role, as required) |

### CI (`.github/workflows/ci.yml`)

| Check | Result |
|---|---|
| Trigger: push + pull_request | Correct |
| `actions/checkout@v4` | Correct |
| `pnpm/action-setup@v4` | **No version specified** — see P1-2 |
| `actions/setup-node@v4` with `cache: pnpm` | Correct |
| Test env creation (heredoc) | YAML block scalar correctly strips 10-space indentation; `.env.local` will have clean key=value lines |
| AUTH_SECRET ≠ TOKEN_SECRET in test env | `ci-only-auth-secret...` ≠ `ci-only-token-secret...` — passes the runtime check |
| `npx tsc --noEmit` | Runs after env creation — correct order |
| `pnpm lint` | Correct |
| `pnpm test:unit` | Uses `node --env-file=.env.local` — correct |
| Integration tests (DB-backed) | **Not in CI** — the only test step runs unit tests with fake DBs. See test-gap plan below. |
| Build step | **Not in CI** — a Next.js build is not verified in CI. Adds confidence; consider adding. |

---

## 8. Test-Gap Plan

The new unit tests added in this commit are well-targeted:

- `outbox.test.ts` — control-flow tests for enqueue, approve, reject, cancel using a fake DB (in-memory)
- `deliveries.test.ts` — tenant-isolation assertions for `applyInboundReceipt`
- `outbound-status.test.ts` — pure state machine transitions
- `storage.test.ts` — local driver round-trip, path traversal rejection, legacy key normalization, S3 driver construction
- `poll.test.ts` — jitter computation

**Gaps identified:**

| Gap | Priority | Recommended test |
|---|---|---|
| **Concurrent `approveAndDispatch` double-send** | HIGH | Integration test (real Postgres): insert one pending row, fire two simultaneous `approveAndDispatch` calls, assert `adapter.send` called exactly once. Requires a real DB connection and a spy adapter. |
| **`approved` state machine inconsistency** | MEDIUM | Add `canTransition('pending_approval', 'sending')` → `false` assertion. This would make the existing inconsistency explicit and fail until fixed. |
| **`listPendingMessages` cross-tenant isolation** | HIGH | Integration test: two tenants, pending messages for each, assert one tenant's `withTenant` call never returns the other's rows. |
| **`approveMessage` server action session guard** | MEDIUM | Unit test that a call without a session redirects to sign-in and never dispatches. |
| **S3 driver error propagation** | MEDIUM | Test that a `GetObjectCommand` failure (e.g., NoSuchKey) surfaces as a thrown error, not a silent empty buffer. |
| **Worker graceful shutdown mid-tick** | LOW | Test that `requestShutdown` during a `drainDueReminders` loop results in `loop()` exiting without processing the next tick. |
| **`cancelMessage` server action** | LOW | At minimum, a unit test that cancel from a non-pending status returns `"not_cancellable"` without a DB write (already partially covered in `outbox.test.ts`). |

---

## 9. PR Checklist and Exact Blockers Before Push

### Blockers (must fix before `git push`)

- [ ] **P1-1: Fix the concurrent-approve race in `approveAndDispatch`** — change the first UPDATE to include `AND status='pending_approval'` in the WHERE clause and check RETURNING. Without this fix, a double-click on the Approve button sends the WhatsApp message twice.

- [ ] **P1-2: Fix `pnpm/action-setup@v4` — add `version: 10`** (or add `packageManager` to `package.json`) so CI doesn't fail on pnpm version resolution.

### Should-fix before merge (P2)

- [ ] **P2-1: Add `TRUST_PROXY: ${TRUST_PROXY:-}` to `docker-compose.yml` web service** to prevent the global login-lockout footgun behind a load balancer.

- [ ] **P2-2: Add `updatedAt: new Date()` to all three UPDATE calls in `outbox.ts`** — otherwise `updated_at` never reflects status-change timestamps.

- [ ] **P2-3: Fix Procfile worker command** — either move `tsx` to `dependencies` or add a compiled entry point, so Heroku-style deploys work with devDep pruning.

- [ ] **P2-4: Resolve the `approved` dead-state inconsistency** — either update TRANSITIONS to allow `pending_approval → sending` or implement the two-step approve/dispatch flow.

### Nice-to-have

- [ ] Add non-root user to Dockerfile (`USER node`).
- [ ] Add `pnpm build` step to CI to catch build-breaking changes before runtime.
- [ ] Add a warning comment in docker-compose.yml that `STORAGE_DRIVER=local` uses ephemeral container storage.
- [ ] Wire the Cancel button to the outbox page UI or document it is intentionally not user-facing.
- [ ] Add `"packageManager": "pnpm@10.x.y"` to package.json for reproducible installs.

### PR hygiene checks

| Item | Status |
|---|---|
| No hardcoded credentials in diff | Pass — `.env.example` has `dev-only-*` placeholders only |
| No accidental secrets in source | Pass — no API keys, tokens, or passwords found in source |
| `.env.example` updated for new vars | Pass — `STORAGE_DRIVER`, `S3_*`, `WHATSAPP_SENDER_NUMBER` all documented |
| Docs updated (`MESSAGING.md`, `PRODUCTION-READINESS.md`) | Pass — both are new in this commit |
| Migration journal/snapshot in sync | Pass — chain 0→12 verified |
| Generated artifacts (snapshot JSON) | Present and consistent with SQL |
| Commit message scope | Accurate — describes approval gate + P0 hardening |
| Commit is a clean, squashed unit | Single commit, reviewable diff |
| Branch safe to push | **Conditional** — fix P1-1 and P1-2 first |

---

## 10. Rollback Considerations

Migration `0012_early_shiva.sql` creates a new `outbound_message_status` enum type and the `outbound_messages` table. Rolling back requires:

1. `DROP TABLE outbound_messages;`
2. `DROP TYPE outbound_message_status;`

Both are safe as long as no application code has written to the table. In the first deploy, if a rollback is needed immediately after `drizzle-kit migrate`, this is executable. After data exists in the table, rollback requires a data migration plan.

The migration is **non-destructive to existing tables** — all existing tables are untouched; only new objects are added. This makes a first-deploy rollback straightforward.

---

## Summary

**CONDITIONAL GO.** The approval-before-send architecture is sound and the prior P0 blockers are correctly resolved. Two issues must be fixed before pushing this branch:

1. **P1-1** (`approveAndDispatch` race → double-send): add `AND status='pending_approval'` to the first UPDATE's WHERE clause and use RETURNING to detect a lost race.
2. **P1-2** (CI pnpm version resolution): add `version: 10` to `pnpm/action-setup@v4`.

With those two fixes in place, this branch is PR-ready. P2 items should be addressed before or immediately after merge.

---

## Phase 0 consolidated review resolution (2026-07-28)

The uncommitted Phase 0 correction pass resolves the review findings with:

- compare-and-set approval, rejection and cancellation; only the winning
  terminal transition emits its terminal audit event;
- fresh database-backed role/active-state resolution on every session request;
- consultant pool visibility with claim-before-write for participant and
  participant-owned task mutations;
- historical appointment attribution through `appointments.consultant_id`;
- explicit stale-`sending` monitoring with manual reconciliation and no blind
  retry;
- migration 0014 changing creator deletion behavior to `ON DELETE SET NULL`;
- deterministic pnpm 9.15.9 visibility in CI; and
- the locally stored official CodeKessel wordmark plus verified `#8F14E0`
  primary token.

The legacy `approved` state remains cancellable only for pre-existing rows; new
approvals atomically transition from `pending_approval` to `sending`. PostgreSQL
enum addition in migration 0013 is forward-fix only and must not be manually
reversed. Manager dashboard/Kanban/history redesign remains outside Phase 0.
