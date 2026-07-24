# QCG Platform — State Review, Benchmark & Next-Increment User Stories

> Single planning source for the app. Snapshot of where the platform stands,
> a benchmark against (a) the original MVP spec and (b) the real BA forms, the
> latest reliability/operability increment (§0), the magic-link review status,
> the WhatsApp integration plan, and prioritized next steps.
>
> Definitions of record for register import, dedup, provenance, pipeline
> statuses and KPIs live in **`docs/REGISTER-IMPORT.md`** — this doc links to
> it rather than restating them.

---

## 0. Current increment — reliability, operability & magic-link hardening

Status after this cycle: **`npx tsc --noEmit` clean · `pnpm lint` clean ·
`pnpm test:unit` 100/100 passing**. Everything below is implemented in the
tree; items still open are called out explicitly.

### 0a. Current-state assessment

The MVP breadth (Phases 1–7) is complete and demo-ready. This cycle did **not**
add new funnel surface; it hardened the parts that touch real money, external
actors, and consultant trust: the register import path, the routing/escalation
idempotency, the availability/eligibility gates, the operational pipeline, and
the single-use magic-link security model. The remaining production gaps are the
same known ones (real BA upload forms, QES signatures, live channels, legal
copy) plus the deferred magic-link P2/P3 items in §0c.

### 0b. What shipped this cycle

- **Register import reliability — idempotent OpenRegister import.**
  Dedup-on-reimport with honest `inserted | updated | skipped | conflicted`
  outcomes; sign-safe financial parsing (missing ≠ 0, cents vs euro, reporting
  year + source); conservative gap-fill that never overwrites consultant edits;
  `import_runs` provenance (one run row per invocation, real counters, failures
  recorded as `failed` — never a blanket "inserted"). Migration `0007`
  (`participants.register_id` / `phone_normalized` / `import_run_id` + partial
  unique/indexes; `import_runs` table + RLS). Full definitions:
  `docs/REGISTER-IMPORT.md` §1–§5.
- **Shared phone normalization** (`src/modules/participants/phone.ts`):
  conservative, digits-only comparable form reused by import, messaging, and
  contact-update paths (never coerces distinct numbers together).
- **Routing & escalation idempotency.** The routing engine refuses to stack a
  second active task for the same `(tenant, type, owner, subject)`
  (`hasDuplicateActiveTask`); the worker escalates each overdue task **at most
  once** (status flip + `escalation_at` cleared) and never stacks duplicate
  escalation follow-ups. The "active task" predicate is now a single shared
  helper (`src/modules/tasks/status.ts`) reused by the engine, the worker, and
  the token service — no more drifting copies.
- **Eligibility / availability gates** (`eligibility-gates.ts`): the mandatory
  20h/week × 6-month gate is enforced for aptitude invites and aptitude-test
  appointments (early-funnel appointments stay ungated).
- **Pipeline operational workspace.** A shared filter → SQL layer
  (`pipeline.ts`, `pipeline-filter.ts`) backs both the KPI aggregates and the
  list, so counts and rows can never disagree; live KPIs, an adjacent-stage
  funnel, filters (status/consultant/source/phone-email/search/date), an
  import-freshness strip, and a CSV export route. KPI/funnel/filter/status
  definitions of record: `docs/REGISTER-IMPORT.md` §4–§5. **Saved filter presets**
  (one-click quick-filter views — Erstkontakt offen, Nicht erreichbar,
  Arbeitgeber offen, Qualifiziert+, In Antrag, Ohne Telefon, Nicht zugewiesen)
  are pure `PipelineFilter`s (`PIPELINE_PRESETS`) that reuse the same
  filter→SQL layer, so a preset link's KPIs and list are always consistent; the
  active preset is highlighted via `serializePipelineFilter`↔`parsePipelineFilter`
  round-trip equality (`isPresetActive`). Tests: `pipeline-presets.test.ts`.
- **Manual WhatsApp send** (`sendTaskWhatsApp`): consultant-initiated,
  session-guarded, tenant-scoped; mock in demo, live behind consent — reuses
  existing `task_<type>` templates. Details: `docs/REGISTER-IMPORT.md` §8.
- **Magic-link Priority-1 hardening (F1–F5)** — see §0c.

### 0c. Magic-link review findings & status

Single-use signed magic links are the only way external actors touch the
system, so the review focused on stale-link, double-submit, and false-success
risks. Priority-1 items are **fixed this cycle**; P2/P3 are deferred with a
rationale.

| ID | Sev | Finding | Status |
|---|---|---|---|
| F1 | High | A link stayed usable after its task was already closed (done/escalated/cancelled), so a stale link could drive a second mutation. | ✅ Fixed — `loadTokenContext` now returns `task_closed` unless the task is active, **except** the intentional multi-use scopes (see below). |
| F2 | High | Token burn (`used_at`) was a plain `UPDATE`, so a concurrent double-submit could run side effects twice. | ✅ Fixed — burn is atomic (`SET used_at=NOW() WHERE id=$1 AND used_at IS NULL RETURNING …`); a lost race performs no further side effects. `completeTaskViaToken` burns **first**, then closes the task. |
| F3 | High | `sendTaskWhatsApp` omitted the `{{link}}` variable. Only the token hash is stored, so the JWT can't be reconstructed. | ✅ Fixed — new `getOrIssueMagicLinkForTask(tx, task)` mints a fresh `/t/{jwt}` link and supersedes (revokes) any still-live token for that task, so only one credential is ever valid. Used in `sendTaskWhatsApp` for `magic_link` tasks. |
| F4 | High | Worker reminders also omitted `{{link}}` and couldn't rebuild the JWT. | ✅ Fixed — reminders for `magic_link` tasks use the same helper; task types with no external-link semantics get no link injected. |
| F5 | Med | External actions redirected to `?done=1` even when the inner mutation didn't run (false success). | ✅ Fixed — each `withTenant` callback now returns a success boolean; the page shows `?done=1` only on real success, otherwise re-renders the task/error (`participants/actions.ts`, `participants/external-actions.ts`, `signatures/actions.ts`, `applications/external-actions.ts`). |

**Intentional multi-use scopes kept (not bugs).** The F1 task-closed gate is
deliberately skipped for `start_aptitude_test` (participant may re-open the link
until they finish the test) and the employer setup wizard scopes
(`employer_setup`, `provide_betriebsnummer`, `confirm_ags_status`,
`confirm_time_model` — valid across visits until the employer is confirmed, when
the token is burned). This re-entry is a drop-off-reduction feature; the
predicate lives in one place (`isMultiUseScope`).

**Deferred (P2/P3):** per-signer token binding beyond scope (multi-signer
co-sign hardening). Now DONE (see §3 F.1/F.1b): rate-limiting / brute-force
protection on the `/t/*` endpoints; structured revocation + audit surfacing for
consultants; and token rotation/expiry policy tuning
(`modules/tokens/policy.ts`, `MAGIC_LINK_TTL_HOURS`, clamped guardrails).

### 0d. WhatsApp Business (Meta Cloud API) integration plan

The `ChannelAdapter` seam already ships a `WhatsAppCloudAdapter`
(`src/modules/messaging/adapters.ts`) that POSTs to the Graph API
(`/{phoneNumberId}/messages`), plus a demo-safe `MockAdapter`. `whatsapp_optin`
consent is modelled and enforced in live mode. Phased plan:

1. **Provision** a WhatsApp Business Account + phone number; set
   `WHATSAPP_ACCESS_TOKEN` + `WHATSAPP_PHONE_NUMBER_ID` (flips `resolveAdapterMode`
   to `live`).
2. **Templates** (✅ payload support shipped): the `WhatsAppCloudAdapter` now
   sends `type:"template"` (HSM) IN ADDITION to the free-form `text` path.
   Business-initiated messages outside the 24-hour window *require* approved
   templates. App `task_<type>` / `reminder_<type>` keys map to a Meta template
   via `resolveWhatsAppTemplate` (`messaging/whatsapp-templates.ts`) — a code
   CONSTANT (no migration): name `qcg_<key>`, ordered body params
   `[firstName, title]`, plus a dynamic URL-button param from `link`. The
   builder `buildWhatsAppTemplatePayload` is pure/network-free (unit-tested).
   Gated by `WHATSAPP_USE_TEMPLATES=true` and only in LIVE mode (creds present);
   MockAdapter stays demo-safe. EXTERNAL DEPENDENCY (not verifiable here): the
   Meta templates must actually be created + approved in WhatsApp Manager and
   the `qcg_<key>` names + placeholder order must match — no real credentials
   were used. If per-tenant names diverge, add a nullable
   `message_templates.meta_template_name` column (migration 0010) that overrides
   the resolver.
3. **Inbound + webhooks** (🟡 route shipped): `app/api/webhooks/whatsapp/route.ts`
   handles Meta's `GET` verify-token subscribe handshake and the `POST` receiver
   for delivery/read/failed receipts + inbound replies. The parse/verify logic is
   pure and unit-tested (`messaging/whatsapp-webhook.ts`:
   `verifyWebhookChallenge`, `isValidWebhookSignature` (HMAC-SHA256 over the raw
   body), `parseWebhookEvents` → normalized status/inbound events). DEMO-SAFE:
   both handlers are inert until `WHATSAPP_WEBHOOK_VERIFY_TOKEN` +
   `WHATSAPP_APP_SECRET` are set (GET 404s, POST acks without processing), and an
   unsigned POST is refused. Env vars added to `lib/env.ts` + `.env.example`.
   **Persistence + reconciliation (shipped):** an outbound live send records the
   provider message id in the new `message_deliveries` table (migration `0010`,
   RLS-consistent); a signed `POST` looks the row up by `provider_message_id` and
   advances its delivery status (`sent → delivered → read`, `failed`) via the
   pure, monotonic `buildDeliveryReceiptUpdate`/`mergeDeliveryStatus`
   (`messaging/delivery-status.ts`), and an inbound reply reopens the
   participant's 24h session window (`participants.whatsapp_window_expires_at`).
   Reconciliation runs on the trusted OWNER connection (`db/system-client.ts`) —
   a Meta callback carries no tenant. Demo-safe: the MockAdapter returns no
   provider id, so nothing is written in demo mode. Tests:
   `delivery-status.test.ts`, `deliveries.test.ts`.
4. **Link handling**: reminders/sends inject a fresh magic link via
   `getOrIssueMagicLinkForTask` (F3/F4); templates must declare the link as a
   URL button/variable.

**Open decisions:** template catalogue + German copy (needs legal sign-off, ties
into Epic E); which flows are proactive (template) vs reply (session);
per-tenant vs shared WABA. RESOLVED: Meta message IDs ARE persisted for receipt
reconciliation (`message_deliveries`, migration 0010); webhook verify-token +
signature handling ships in `app/api/webhooks/whatsapp` gated on env.

---

## 1. What we built (state review)

| Phase | Scope | Status | Proof |
|---|---|---|---|
| 1 | Foundation: schema+RLS, internal auth, magic-link tokens, portal shells, seed | ✅ done | `e2e/phase1.spec.ts` |
| 2 | Pipeline + intake, call script, contact notes, eligibility, **availability gate** | ✅ done | `e2e/phase2-3.spec.ts` |
| 3 | Appointments + no-show routing, channel adapters (mock), reminders/escalation worker, aptitude tests | ✅ done | `e2e/phase2-3.spec.ts` |
| 4 | Participant + employer portals, 4-step employer setup assistant (partial saves) | ✅ done | `e2e/phase4-5.spec.ts` |
| 5 | Central data collection → checklist → pdf-lib generation (AcroForm autofill + drawn PDFs), canvas signatures w/ audit trail | ✅ done | `e2e/phase4-5.spec.ts` |
| 6 | Submission readiness gate, missing submission routing rules, **analytics dashboard** (all §17 KPIs + funnel + filters) | ✅ done | `e2e/phase6.spec.ts` |
| 7 | **Multi-signer co-signing**: parallel signers, `partially_signed` state, `finalizeIfComplete()` under `FOR UPDATE`, stamped artifact + appended audit certificate | ✅ done | `e2e/phase7-signatures.spec.ts` |

**Baseline numbers:** 88 TS files · ~8.6k LOC · 18 tables · 25 seeded routing rules · 11 server-action modules · 10 console pages · 10 external task components · **22/22 E2E passing** (5 spec files) · lint/typecheck/build clean.

> **Runnable benchmark:** click-by-click walkthroughs for every scenario below
> live in `benchmark/scenarios.md` (BM-1…BM-9). Ghost fixture data:
> `benchmark/ghost-company.md`.

**Architecture strengths now proven by tests:** DB-backed rules engine (status transition → routed task + magic link + reminders), RLS on every query via `withTenant`, single-use signed magic links for all external actors, append-only audit log, derived employer status, and live-SQL analytics with no extra infra.

---

## 2. Benchmark

### 2a. MVP feature coverage (README §18 — 26 items)

| # | MVP feature | State |
|---|---|---|
| 1–10 | Lead mgmt, pipeline, call script, contact notes, eligibility, availability check, follow-up appts, templates, reminders, aptitude test | ✅ |
| 11–16 | Employee profile, employer profile, AG-S assistant, BNR instructions, AG-S instructions, central data collection | ✅ |
| 17–19 | Document checklist, PDF autofill/generation, role-based task links | ✅ (sample/placeholder) |
| 20–22 | Employee portal, employer portal, digital signatures | ✅ (SES canvas only) |
| 23–26 | Application package export, submission tracking, reminder/escalation, no-show/drop-off reporting | ✅ |

**MVP breadth: 26/26 (100%).** But several are depth-limited by placeholders — see 2c.

### 2b. Real-BA-form data coverage — **PIVOTED to the BA eService** (see `docs/ESERVICE-ANTRAG.md`)

**Kernerkenntnis (Juli 2026):** the application is submitted **online** via the
BA eService (`web.arbeitsagentur.de/aezo`). The large AEZ-Antrag form
(ba042359, 149 fields) **is obsolete** — those answers go into the eService
online. PDFs are now only **uploaded** where the eService requires it. Two
paths share one document pool:

| Path | eService flow | `applications.applicant_type` | Required PDF uploads |
|---|---|---|---|
| Einzelantrag | "Arbeitsentgeltzuschuss – Antrag", 6 Schritte | `single` | Trägerbescheinigung (ba042369) |
| Sammelantrag (Firma) | "Sammelantrag – AEZ und Weiterbildungskosten", 7 Schritte | `company` | Lehrgangskosten-Nachweis, Träger-/Maßnahmezertifikat, **Teilnehmerliste** (BA I FW 501/502) |

That shrinks Epic B's target from "7 PDFs / 535 fields" to the **6 upload
forms** the eService actually needs. Builder status in
`src/modules/documents/ba-forms.ts`:

| Form (BA-Nr.) | Upload path | Builder | Status |
|---|---|---|---|
| Trägerbescheinigung (ba042369) | single step 3 / company step 3 | `buildTraegerbescheinigungValues` | ✅ done (15 fields, verified vs `AZAV/Page3.pdf`) |
| Sammelantrag-Teilnehmerliste (BA I FW 501/502) | company step 4 | `buildTeilnehmerlisteValues` | ✅ done (Kopf + rows; SV-Nummern jetzt aus zentralen Daten, Epic A) |
| Arbeitnehmererklärung (ba042354) | single upload | `buildArbeitnehmererklaerungValues` | ✅ done (11/16 mapped; GdB/ungelernte Tätigkeit/Bedarfsgemeinschaft bleiben leer, da nicht erfasst) |
| Vollmacht (ba051211) | participant sign | `buildVollmachtValues` | ✅ done (Anlage + Vollmacht; Radios nur bei belegten Daten, sonst leer; Kundennr./Arbeitserlaubnis/GdB/Geburtsort/Familienstand nicht erfasst) |
| Teilnehmer-Fragebogen (ba046157) | supplemental | `buildFragebogenValues` | ✅ done (~28/190 aus zentralen Daten; FB-Block Person/Bank/Maßnahme/Berufsabschluss; AFB-Fahrkosten-/Betreuungs-Anhang bleibt leer — nicht erfasst) |
| Schlusserklärung (ba042364) | after measure end | — | ⬜ entfällt bei eService-Antrag (112 fields) |

**Headline: 5 of 6 upload forms are wired; only Schlusserklärung remains (entfällt bei eService).**

Still-missing data (plan.md §186) is now **captured by Epic A** — nullable
columns on `participants` (SV-Nummer, IBAN/BIC, Gehalt + Komponenten, Wochen-/
Monatsstunden, Schulungszeiten je Wochentag, Freistellungsstunden,
Berufsabschluss-Historie, KuG/EGZ-Status) and `employers` (Rechtsform,
Geschäfts-IBAN/BIC, Beschäftigtenzahlen nach Stunden-Faktoren, Vergütungs-
bestandteile, Betriebsvereinbarung/Tarifvertrag) via migration `0008`,
editable in the internal detail pages and the employer setup assistant, and
returned by `collectApplicationData()`.

### 2c. Production-readiness scorecard

| Layer | Grade | Note |
|---|---|---|
| Schema + RLS + multi-tenancy | 🟢 production | enforced, tested |
| Auth (internal + magic links) | 🟢 production | signed, hashed, single-use |
| Routing/rules engine + worker | 🟢 production | data-driven, escalations |
| Audit log | 🟢 production | append-only, PII-minimal |
| Analytics | 🟢 demo-ready | live SQL, fine for MVP volume |
| Document generation | 🟡 scaffold | works; **2 of 6 real eService upload forms wired** (Trägerbescheinigung, Teilnehmerliste) against AcroForm autofill |
| Real BA forms | 🟡 partial | 4 of 6 upload forms still unmapped; AEZ-Antrag (ba042359) obsolete via eService pivot |
| Signatures | 🟡 SES only | Per-form SES/QES classification centralised (Epic C); SES canvas real; QES provider (Skribble/Yousign) behind interface, not connected |
| Channels (WhatsApp/email) | 🟡 mock | adapters exist, no real credentials |
| Legal/consent/BA copy | 🔴 placeholder | pending legal review |

---

## 3. Next increment — user stories (prioritized)

Goal: turn the placeholder document layer into the real "customer fills the BA forms" loop. Ordered by value × readiness.

### Epic A — Capture the missing data (enabler for everything else)
> **US A1** — As a consultant, I want to record a participant's SV number, bank details, exact monthly working hours/salary, qualification, and funding history **so that** the BA forms can be prefilled without rekeying.
> **US A2** — As an employer, I want to enter company legal form, business account IBAN, staffing by hours-band, and salary components through the setup assistant **so that** the AEZ application is complete.
- **Acceptance:** new nullable columns on `participants`/`employers` (+ migration); fields editable in the portals and the internal detail page; `collectApplicationData()` returns them; e2e covers a fully-populated participant.
- **Effort:** M · **Risk:** low (additive) · **Unlocks:** Epics B, C.

### Epic B — Wire the real BA PDFs (the core customer value)
> **US B1** — As a consultant, I want to generate the **Teilnehmer-Fragebogen** (`ba046157`) and the **AEZ-Antrag** (`ba042359`) prefilled from central data **so that** I hand the customer a ready-to-sign BA form.
> **US B2** — As the provider (Träger), I want the **Trägerbescheinigung** (`ba042369`) generated from the measure + enrollment data **so that** I confirm the measure started.
> **US B3 (company path)** — As a consultant, I want the **Sammelantrag-Teilnehmerliste** (`ba501-502`) generated for the whole cohort **so that** the company uploads one list per employer + measure.
- **Done:** US B2 (`buildTraegerbescheinigungValues`), US B3
  (`buildTeilnehmerlisteValues`), both registered in `DOC_TYPES`
  (`documents/actions.ts`), plus `applicant_type` on `applications`
  (migration `0005_bright_namora.sql`) and `eservice_single`/`eservice_company`
  companion sheets. US B1's `ba042359` is **obsolete** under the eService pivot.
- **Revised acceptance (remaining forms):** the upload forms live in
  `templates/pdf/`; each builder in `ba-forms.ts` maps `field → data path` and
  is registered in `DOC_TYPES`; missing data still produces a `data_missing`
  doc + clarification task (existing behaviour).
- **Effort:** M (3 remaining forms: arbeitnehmererklaerung 16, vollmacht 42,
  fragebogen 190 fields) · **Risk:** medium · **Depends:** Epic A for SV-Nummer,
  bank, salary, working-hours data.

### Epic C — Real signature flow on real forms
> **US C1** — As a participant, I want to sign the prefilled Fragebogen/Vollmacht on my phone **so that** my declaration is legally captured.
> **US C2** — As an admin, I want to know which signature type (SES vs QES) each form requires **so that** I don't under-sign legally sensitive docs.
- **Acceptance:** reuse the canvas SES path for declarations; mark QES-required forms; behind the existing `SignatureProvider`.
- **Effort:** S (SES reuse) / L (QES provider) · **Depends:** Epic B.
- **US C2 (✅ done):** central per-DOC_TYPE signature classification in
  `src/modules/signatures/requirements.ts` — the SINGLE source of "which form
  needs whose signature at which eIDAS level", consumed by `DOC_TYPES`
  (`documents/actions.ts`, `withSignatures`) and the readiness evaluator.
  Classification: **Arbeitnehmererklärung (ba042354)** + **Fragebogen
  (ba046157)** = participant **SES** (canvas, real, end-to-end); **Vollmacht
  (ba051211)** = participant **QES** — legally qualified, **no provider
  connected**, so it is marked required-but-QES and is NEVER canvas-signable
  (not faked). `evaluateApplicationReadiness` gained two derived checks:
  `form_signatures_ses` (**blocker** — an unsigned SES form on a generated doc
  blocks complete/submitted) and `form_signatures_qes_pending` (**warning** —
  QES gap surfaced honestly, cannot block without a vendor). Tests:
  `tests/unit/signature-requirements.test.ts`.
- **US C3 (✅ done — readiness + package):** path-aware eService upload set
  centralised in `src/modules/applications/upload-set.ts`
  (`ESERVICE_UPLOAD_SETS`, `evaluateUploadSet`, `resolveApplicantType`), keyed by
  `applications.applicant_type` per `docs/ESERVICE-ANTRAG.md`. Single requires
  Trägerbescheinigung + a **signed** Arbeitnehmererklärung (Fragebogen/Vollmacht
  optional); company requires Teilnehmerliste + Kostenübersicht.
  `evaluateApplicationReadiness` gained the `upload_set_incomplete` **blocker**
  (required uploads must be generated and, where SES-signable, signed) — enforced
  server-side by the existing `changeApplicationStatus` gate for complete/
  submitted; QES gaps stay a warning. The package export
  (`applications/package.ts`) prints a per-path "eService-Upload-Set" inventory
  with ✓/⧗/✗ signed-vs-pending marks, and the internal documents page surfaces
  the same status. Tests: `tests/unit/application-upload-set.test.ts`.
- **US C1 (✅ SES done / QES marked):** the new SES forms (Arbeitnehmererklärung,
  Fragebogen) are signable through the EXISTING external flow — the same
  `requestSignature` action, `signature`-entity routing rules (participant/
  employer magic-link, reminders + escalation), `/t/[token]` canvas page, and
  `finalizeIfComplete()` (stamp + audit certificate). No new signing mechanism.
  `requestSignature` now consults the classification (`canRequestCanvasSignature`)
  so a classified form can only be requested for its declared signer and a QES
  signer is refused on the canvas (no fake QES); the F1/F2 hardening (task-status
  gate, atomic burn, single live credential) is untouched. The documents page
  hides non-declared signer buttons and marks QES forms
  "QES erforderlich — Anbieter nicht angebunden". QES (Vollmacht) awaits a
  connected provider. Tests extended in `tests/unit/signature-requirements.test.ts`.

### Epic D — Real channels (outbound)
> **US D1** — As a consultant, I want WhatsApp reminders actually delivered **so that** no-shows drop.
- **Acceptance:** drop Meta-approved templates + credentials into the existing `ChannelAdapter`; consent captured (already modelled).
- **Effort:** M · **Depends:** legal sign-off on templates.

### Epic E — Legal/content
> **US E1** — As the product owner, I want real consent texts, privacy policy, and BA form content validated **so that** the platform is compliant.
- **Acceptance:** replace `PLATZHALTER` copy; versioned consent records (already supported).
- **Effort:** non-engineering (client/legal) · **Blocks:** production go-live.

### Epic F — Hardening & operability backlog (next steps)
> Prioritized follow-ups from this cycle. All items below are **not yet
> implemented** unless stated.
- **F.1 Magic-link P2** (✅): single-live-credential + clean completion.
  `completeTaskViaToken` now revokes sibling unused tokens for the task and
  cancels its scheduled `reminder_jobs` on burn (no waiting for the worker
  poll); `issueLinkForTask` re-issues via `getOrIssueMagicLinkForTask` (shared
  supersede helper `revokeUnusedTokensForTask`); employer-setup completion goes
  through `completeTaskViaToken` for a consistent `task_completed` audit; and
  `confirmSubmission` is wrapped in try/catch → `/t/{token}?error=1` friendly
  screen instead of a raw 500. Tests extended in `tests/unit/token-service.test.ts`.
- **F.1b Magic-link P3** (🟡 in progress):
  - **Rate-limiting on `/t/*`** (✅): the anonymous surface is throttled per-IP
    via the existing in-memory limiter (`lib/rate-limit`), wrapped in
    `tokens/throttle.ts` (pure, unit-tested) + `tokens/request-throttle.ts`
    (reads the forwarded IP). Both the page load (`app/t/[token]/page.tsx`,
    generous `TOKEN_PAGE_LIMIT` 60/min) and every external server-action
    submission (`TOKEN_ACTION_LIMIT` 20/min) check-and-count before any
    token/DB work; over-budget callers get the friendly `taskPage.throttled`
    screen (page) or a `/t/{token}?throttled=1` redirect (actions) — no stack
    trace. Keyed PER-IP (never per-token) so the intentional multi-use scopes
    (`start_aptitude_test`, employer wizard) can re-enter freely. LIMITATION:
    buckets are per-process — behind >1 instance the effective budget is
    `limit × instances`; move to Redis/Postgres for a hard global cap. Tests:
    `tests/unit/token-throttle.test.ts`.
  - **Consultant-facing revocation + audit surfacing** (✅): the previously
    unused `revokeToken` is now wired into a session-guarded, tenant-scoped
    `revokeTaskLink` server action (`tasks/actions.ts`) that revokes every
    still-live token for a task (`listLiveTokenIdsForTask` → per-token
    `revokeToken`, mirroring the automatic bulk `revokeUnusedTokensForTask`)
    and writes a `link_revoked` activity-log entry. The tasks list now surfaces
    each task's link state via `getTaskLinkState`/`listOpenTasks` and the pure
    `deriveTaskLinkDisplayStatus` — a "Link aktiv" / "Link widerrufen" badge
    plus a "Link widerrufen" action button (only when a live link exists), so a
    consultant can see and act on an invalidated link. Tests:
    `tests/unit/token-link-status.test.ts`.
  - **Token rotation/expiry policy tuning** (✅): the TTL/expiry rules are now
    centralised in `modules/tokens/policy.ts` (`resolveTokenTtlHours`,
    `computeTokenExpiry`, `clampTtlHours`) — no more scattered `7 * 24` literals.
    Lifetime is configurable via `MAGIC_LINK_TTL_HOURS` (default 168h) and always
    clamped to `[1, 720]` so a misconfig can neither mint an immortal nor an
    already-useless link. Rotation on re-issue is unchanged and consistent: a
    re-issue mints a fresh token and supersedes the previous live one
    (`getOrIssueMagicLinkForTask` → `revokeUnusedTokensForTask`), resetting the
    TTL on a brand-new credential. All F1–F5/P2/P3 hardening preserved. Tests:
    `tests/unit/token-policy.test.ts`.
- **F.2 Participant transition state-machine** (✅): `participant_status`
  transitions are now an explicit, typed state-machine
  (`participants/status-machine.ts`: `ALLOWED_PARTICIPANT_TRANSITIONS`,
  `isParticipantTransitionAllowed`, `ParticipantTransitionError`). The phase
  chain is derived from `PIPELINE_STATUS_ORDER` (no duplicated ordering); the
  early-funnel outcomes are mutually reachable so call-script quick actions stay
  valid; `lost` is an escape hatch from every non-terminal status. Enforced
  server-side in `changeParticipantStatus` on top of the availability gate.
  Undo bypasses the map (direct column write); the BA approval → enrolled path
  passes `skipTransitionGuard` (authoritative). Tests:
  `tests/unit/participant-transitions.test.ts`.
- **F.3 Regional OpenRegister discovery filters** (✅ region + legal-form):
  configurable federal-state (default Baden-Württemberg, `DEFAULT_FEDERAL_STATE`)
  and legal-form filters added to `DistressedCriteria` and the import UI. Applied
  CLIENT-SIDE after fetch (`register/filters.ts`) because OpenRegister exposes no
  confirmed server-side filter field for them; region uses a configurable PLZ-
  prefix → state map over the search row's optional `postal_code`. Batch import
  now writes ONE `import_runs` row with real stats
  `{discovered, inserted, updated, skipped, conflicted, failed}` (`tallyBatch`,
  `importCompanies`). Tests: `register-filters.test.ts`, batch cases in
  `import-run.test.ts`.
  - **Structured financial provenance** (✅): the discovery loss signal is now
    persisted as real `participants` columns — `net_income`
    (`numeric(14,2)`, sign-safe, nullable), `financial_year` (`integer`),
    `financials_source` (`text`) — via migration `0009_financial_provenance`
    and the pure `buildFinancialColumns()` (`register/import-run.ts`), written
    on insert and conservatively gap-filled on re-import (`register/actions.ts`)
    in ADDITION to the free-text `eligibility_notes`. A missing figure stays
    null (never coerced to 0); a genuine break-even 0 is preserved. Carried
    from the import UI hidden fields and surfaced read-only on the lead detail
    page. Tests: parse→persist mapping in `import-run.test.ts`. Docs:
    `REGISTER-IMPORT.md` §3 (provenance gap closed).
  - **Industry/NACE (Branche) discovery filter** (✅): optional `industryCodes`
    added to `DistressedCriteria` and the import UI (checkbox list from the
    configurable `INDUSTRY_OPTIONS`). Applied CLIENT-SIDE after fetch in
    `applyDiscoveryFilters` via `matchesIndustry` (leading-digit division-prefix
    match, e.g. "86" keeps "86.10.0"), consistently with the region/legal-form
    filters — OpenRegister exposes no confirmed server-side industry filter, so
    the company's best-effort `industryCode` is read leniently from the search
    row (mirrors the confirmed company-detail `industry_codes`) and the mock
    surfaces it from the fixtures. A company without a code is excluded when a
    specific Branche is selected. Tests: `register-filters.test.ts`.
- **F.4 WhatsApp phases** (🟡 in progress): §0d step 2 (templates) DONE in code
  — `WhatsAppCloudAdapter` sends `type:"template"` (HSM) alongside the text path,
  with the app-key → Meta-template + ordered-param mapping in
  `messaging/whatsapp-templates.ts` (config constant, no migration), gated by
  `WHATSAPP_USE_TEMPLATES` and live-mode creds; MockAdapter unchanged
  (demo-safe). Env vars added to `lib/env.ts` + `.env.example`. Tests:
  `messaging-adapters.test.ts` (payload builder + mapping + mode toggle).
  §0d step 3 **inbound + webhooks** — shipped: the webhook route
  (`app/api/webhooks/whatsapp/route.ts`, Meta `GET` verify-token handshake +
  signed `POST` receiver, pure/unit-tested parse+verify helpers in
  `messaging/whatsapp-webhook.ts`) PLUS delivery-status persistence
  (`message_deliveries`, migration 0010) and 24h-window reopen on inbound —
  provider message ids recorded on live sends, receipts reconciled on the owner
  connection. Demo-safe/inert without `WHATSAPP_WEBHOOK_VERIFY_TOKEN` +
  `WHATSAPP_APP_SECRET` (and no provider id in mock mode).
  DEFERRED / external-dependency: real Meta template creation + approval (needs
  client WABA credentials); provision (step 1) + real link handling still pending
  client creds. (Delivery-status persistence + 24h-window reopen wired in the
  next commit.)
- **F.5 Import run-history + E2E for this cycle** (✅): the pipeline page now
  renders an import & enrichment run-history panel (`listImportRuns` in
  `participants/pipeline.ts` → `ImportRunHistory`) with honest states
  (`running`/`abgeschlossen`/`fehlgeschlagen`), started-by, timestamps, real
  stats, and a capped error summary for failed runs. Playwright coverage added
  in `e2e/phase8-run-history.spec.ts`: pipeline filter URL-persistence (survives
  reload), register import happy path → the completed `openregister` run appears
  in the history panel, and the single-use magic-link "already completed" +
  invalid/expired token states. E2E execution needs a running dev server + seeded
  DB; specs are authored against real selectors but were NOT executed in this
  environment (no server/DB) — unit/tsc/lint are green.
- **F.6 Unified application readiness** (✅): merged `computeReadiness`
  (structural) and `buildChecklist` (full) into ONE severity-tiered evaluator
  `evaluateApplicationReadiness` (`documents/data.ts`) with `blocker`/`warning`
  tiers. Blockers now cover the full submission package — participant data,
  privacy consent, employer BA prerequisites (Betriebsnummer + confirmed AG-S),
  a linked measure, AND all required signatures. Enforced server-side in
  `changeApplicationStatus` for both `complete` AND `submitted`; the UI
  checklist projects the same checks. Tests:
  `tests/unit/application-readiness.test.ts` (+ existing `checklist.test.ts`).

---

## 4. Suggested sequencing

```
A (schema/fields)  ─┬─► B (wire real BA PDFs) ──► C (sign real forms)
                    └─► D (real channels)            │
                                                      ▼
                                            E (legal) → go-live
```

**Next smallest valuable slice:** Epic A — capture SV-Nummer, bank, salary and
working-hours data (magic-link forms for participant + employer), which unblocks
the 3 remaining upload forms (arbeitnehmererklaerung, vollmacht, fragebogen).
The proof-of-concept slice (Trägerbescheinigung) is already live.
