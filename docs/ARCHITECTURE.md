# Architecture — QCG Application & Onboarding Platform

Status: All six phases implemented. See README for product concept.

## Core idea

The product is a drop-off-reduction machine. Every entity is a state machine;
a **status transition** is the atomic event. Transitions feed a DB-backed
**rules engine** that decides who gets which task on which channel. External
people (participants, employers) never log in — they act through
single-purpose, expiring, signed **magic links**.

```
status change (any entity)
      │  recorded in activity_log (append-only)
      ▼
processTransition()  ──matches──▶  routing_rules (DB table, seeded from spec)
      │ creates
      ▼
 tasks (+ owner: user | participant | employer)
      │                                 │
      ▼                                 ▼
 magic_link_tokens (external owners)   reminder_jobs (worker drain)
```

## Stack decisions

| Area | Choice | Rationale |
|---|---|---|
| Framework | Next.js 16 App Router, TS | as specified; note: `proxy.ts` replaced middleware, dynamic APIs are async |
| ORM | Drizzle | first-class RLS: per-transaction `set_config` works with its driver model |
| DB | Postgres 16 (Docker locally) | RLS-enforced multi-tenant-ready |
| Jobs | `reminder_jobs` table drained by `src/jobs/worker.ts` | zero extra infra for MVP; pg-boss/Inngest can drop in later |
| Auth (internal) | jose-signed session cookie + bcrypt credentials | self-contained, no third-party identity processor; swappable for Auth.js |
| Tokens (external) | HS256 JWT + DB row (SHA-256 hash) | JWT alone can't be revoked; row gives single-use + audit |
| i18n | next-intl, German-first | messages/de.json primary, en.json internal fallback |
| Docs (Phase 5) | pdf-lib | no headless Chromium dependency; supports AcroForm fill and drawn PDFs |
| Signatures (Phase 5) | signature_pad + audit log behind `SignatureProvider` | Skribble/Yousign (QES) can drop in |

## Security model

- **RLS**: app runtime connects as `qcg_app`; every query runs inside
  `withTenant(tenantId, fn)` which sets `app.tenant_id` for the transaction.
  No setting ⇒ zero rows. Migrations/seed run as table owner (RLS bypass by
  design, never at runtime).
- **Append-only**: `activity_log`, `consent_records` — INSERT+SELECT only,
  enforced by both revoked grants and RLS policies.
- **Login exception**: `auth_lookup_user(email)` is the single tenant-unscoped
  read (SECURITY DEFINER) because no tenant exists before login.
- **Magic links**: `/t/[token]` validates JWT signature → opens tenant-scoped
  transaction from the JWT's tenant claim → checks the DB row
  (hash match, not used, not revoked, not expired) → renders exactly one task
  component. Completion burns the token (single-use).
- **Secrets**: `AUTH_SECRET` ≠ `TOKEN_SECRET` (enforced at startup by zod env
  validation in `src/lib/env.ts`).
- **PII**: `activity_log.meta` carries IDs/statuses only, never names/phones.

## Module map

```
src/
├── app/
│   ├── (internal)/        # authed console: pipeline, tasks, … (guard in layout)
│   ├── auth/sign-in/      # internal credentials sign-in
│   └── t/[token]/         # ALL external single-task pages
├── components/
│   ├── internal/          # console shell components
│   └── task-pages/        # one component per external task scope
├── modules/               # framework-free domain logic
│   ├── auth/              # session (jose cookie), login/logout actions
│   ├── tokens/            # issue / validate / consume / revoke magic links
│   ├── routing/           # processTransition() rules engine
│   ├── audit/             # activity_log writer
│   ├── participants/      # queries + external task actions
│   └── tasks/             # task queries (dashboard)
├── db/
│   ├── schema/            # one file per entity, enums in enums.ts
│   ├── client.ts          # app-role drizzle client + withTenant()
│   └── seed.ts            # demo data, owner connection
├── i18n/ + messages/      # next-intl, de primary
└── styles/                # tokens.css + global.css (design system)
```

## Data model

18 tables. Status enums (Postgres enums) mirror the concept README exactly:
participants (14 pipeline states + availability gate), employers (8 setup
states incl. `betriebsnummer_missing`, `ags_unclear`, `time_model_pending`),
appointments, aptitude_tests, tasks, documents, signatures, applications,
reminder_jobs — plus tenants, users, measures, routing_rules,
magic_link_tokens, message_templates, consent_records, activity_log.

Special transition keys: participant availability answers are processed as
`availability_<answer>` transitions so routing rules can react to the
20h/6-month gate without overloading the pipeline status.

## Legal / compliance flags (unresolved, tracked)

1. Canvas signature = eIDAS SES only; BA acceptance per form must be verified
   by the client. QES via provider interface if needed.
2. WhatsApp business-initiated messages need Meta-approved templates + opt-in
   (captured as consent_records).
3. Consent texts / privacy policy / retention periods are placeholders pending
   legal review.
4. All PDF/form content is placeholder until real BA forms arrive.

## Phase status

- [x] Phase 1 — Foundation: schema+RLS, internal auth, token infra, portal
      shells, seed, E2E smoke (e2e/phase1.spec.ts)
- [x] Phase 2 — Pipeline + intake: lead CRUD, lead detail with call script +
      eligibility form + contact notes, availability gate enforced in
      changeParticipantStatus (AvailabilityGateError), call-outcome quick
      actions (e2e/phase2-3.spec.ts)
- [x] Phase 3 — Scheduling + comms: appointments with no-show routing,
      channel adapters (Meta WhatsApp Cloud API / Resend when credentials are
      configured, mock adapters otherwise),
      DB-backed template rendering, reminder engine (reminder_jobs drained
      by src/jobs/worker.ts, `pnpm jobs:dev`), escalation past
      escalation_at → admin follow-up task, aptitude-test tracking with
      passed/failed/no-show rules. Design note: the polling worker replaced
      pg-boss — reminder_jobs already is the queue; pg-boss would duplicate
      it. The worker runs as a trusted system process on the owner
      connection (like the seed).
- [x] Phase 4 — Participant & employer portals: all magic-link task pages
      (contact correction, availability, consent w/ versioned records,
      test start, reschedule-after-no-show, uploads) plus the employer
      setup assistant (Betriebsnummer → AG-S → contact → time model) with
      partial saves that keep the token valid until complete; employer
      status is DERIVED from the next bottleneck (employers/service.ts);
      consultants can mint/re-issue links from the task board (tokens are
      stored hashed and cannot be recovered, only re-minted).
- [x] Phase 5 — Documents + signatures: central data collection
      (documents/data.ts) → checklist → pdf-lib generation. Two modes:
      AcroForm autofill against a generated SAMPLE template (real BA forms
      drop into templates/pdf/ with a mapping json) and drawn summary PDFs
      (cost overview, employer datasheet). Design note: pdf-lib covers both
      modes, so React-PDF was dropped (one dependency fewer). Missing data
      → data_missing document + routed clarification task. Signatures:
      canvas (signature_pad) behind SignatureProvider (Skribble/Yousign
      later), audit evidence = name + timestamp + IP + document SHA-256 +
      stored PNG; two routing rules (participant/employer signer) — the
      request puts only the actual signer in the transition context so
      exactly one matches. PDFs stream through token-gated
      (/t/[token]/document) and session-gated (/api/documents/[id]/download)
      routes; files live under var/ (gitignored).
- [x] Phase 6 — Submission + analytics: submission readiness gate blocking
      `complete` until the structural BA requirements are met (employer +
      Betriebsnummer + AG-S confirmed + measure) — surfaced in the UI and
      enforced in `changeApplicationStatus` (ApplicationNotReadyError). The
      three previously-missing submission routing rules seeded
      (`submitted` → consultant tracks BA response, `response_pending` →
      admin follow-up, `correction_required` → consultant fixes). Analytics
      dashboard at `/reports` computes every §17 KPI live from the entity
      tables (leads/contact/wrong-number, no-show, aptitude-test completion
      + pass, employer approval + missing-BNR/AG-S, submission + approval,
      avg lead→application time, and a per-status drop-off funnel) with
      date-range + consultant filters. Design note: metrics read current
      entity state (the funnel describes present distribution), while the
      append-only activity_log remains the audit trail — no extra rollup
      table for the MVP's volume.

## Hardening pass (post-Phase 6)

- **Security headers** (`next.config.ts`): CSP (self-only — no third-party
  scripts/fonts/CDNs), `X-Frame-Options: DENY` + `frame-ancestors 'none'`
  (matters for the external `/t/[token]` pages), `X-Content-Type-Options`,
  `Referrer-Policy`, `Permissions-Policy`, and HSTS in prod. CSP still allows
  `'unsafe-inline'` for scripts/styles — a `proxy.ts` nonce is the tracked
  TODO(nonce) in the config.
- **Login throttle** (`src/lib/rate-limit.ts`): in-memory *failed-attempt*
  limiter (10 failures / 5 min / IP); a success clears the bucket so real
  users are never blocked. Per-process — move to Redis/Postgres behind
  multiple instances.
- **Availability-gate fix**: BA approval → `enrolled` passes
  `skipAvailabilityGate` so the 20h gate can't roll back a granted
  application whose availability answer was never explicitly stamped "yes".
- **Unit tests** (`tests/unit/`, `pnpm test:unit`): Node's built-in
  `node:test` runner via tsx (zero new deps). Covers the pure logic —
  availability gate, application transition map, employer-status derivation,
  template interpolation, checklist builder, rate limiter. 25 tests.
  Playwright E2E (`e2e/`, 21 tests) remains the integration layer.

## Signatures (multi-signer + signed artifact)

The signature path is PDF + canvas-drawn signature + audit row (eIDAS SES).
Both previously-tracked gaps are now closed:

- **Signed PDF is produced.** When the last required signature is collected,
  `finalizeIfComplete` (`signatures/finalize.ts`) builds a signed artifact via
  `generateSignedArtifact` (`documents/generate.ts`): each drawn signature is
  stamped into the last-page footer band **and** an "Unterschriften-Nachweis"
  (SES audit certificate) page is appended, listing every signer with name,
  timestamp, IP, provider, thumbnail, and the original document SHA-256. The
  result is stored on `documents.signed_file_path` / `signed_sha256`; the
  original `file_path`/`sha256` stay untouched as the integrity anchor (what
  was actually signed). The internal download, the token document route, and
  the application package all prefer the signed artifact.
- **Co-signed documents complete correctly.** A consultant may request a
  participant and/or employer signature; the set of `signatures` rows is the
  required set. Signing one moves the document to `partially_signed` (new
  `document_status` enum value); only when *every* requested signature is
  signed does it become `signed` and fire the downstream `document/signed`
  rule. Signing is parallel (either order). A `SELECT … FOR UPDATE` on the
  document row serializes simultaneous co-signers so they cannot double-
  finalize. Pure predicates (`signatureProgress`, `canRequestSigner`) live in
  `signatures/progress.ts` and are unit-tested; the full two-signer flow is
  covered by `e2e/phase7-signatures.spec.ts`.

Still SES-only: identity is link-possession + self-typed name (no OTP/QES),
and stamping uses a fixed footer band — real BA forms should later declare a
signature-field rect in their mapping json. External QES providers
(Skribble/Yousign) still drop in behind `SignatureProvider`.
