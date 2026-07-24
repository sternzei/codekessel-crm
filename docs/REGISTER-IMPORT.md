# Register Import (OpenRegister → Leads)

How the admin-only OpenRegister company import works today, what it stores, and
what is deliberately **not** implemented in this app. This document reflects the
real code — file paths are cited so you can verify each claim.

> Scope: everything here lives in `src/modules/register/*`, the admin import
> page (`src/app/(internal)/leads/import/page.tsx`), and the pipeline read
> models (`src/modules/participants/pipeline*.ts`). Lead == `participants`.

---

## 1. OpenRegister discovery & enrichment

Provider selection is env-driven (`src/modules/register/index.ts`): with
`OPENREGISTER_API_KEY` set it uses the live `OpenRegisterProvider`, otherwise a
demo-safe `MockRegisterProvider` (zero network calls, zero credits). The mock
returns two fixture companies so the whole flow works locally.

### Discovery — `searchDistressed()`

`OpenRegisterProvider.searchDistressed()`
(`src/modules/register/openregister.ts`) POSTs to `/v1/search/company` with a
**fixed** server-side filter set:

- `status = active` — only active companies.
- `employees` in `[employeesMin, employeesMax]` — the range chosen in the UI
  (defaults **10–50**, `src/app/(internal)/leads/import/page.tsx`).
- `net_income max = -1` — loss-makers only (financial distress is the target
  AZAV profile).
- Pagination via `page` / `per_page` (UI uses `perPage = 25`).

**Client-side narrowing (region + legal form).** On top of the server-side
filters, the discovery page supports an optional **federal state** (default
`baden-wuerttemberg`, configurable via `DEFAULT_FEDERAL_STATE`) and **legal-form**
selection. OpenRegister exposes no confirmed server-side filter field for either,
and the search rows only reliably carry `address.city` (+ optional
`postal_code`) and `legal_form` — so these are applied **client-side after the
fetch**, over the returned page, in `src/modules/register/filters.ts`
(`applyDiscoveryFilters`). Region matching maps the company's `postal_code` to a
state via a configurable **PLZ-prefix table** (`FEDERAL_STATE_POSTAL_PREFIXES`,
approximate at state borders); a company with no postal code is excluded when a
specific state is selected. Because the narrowing happens after fetch, it filters
the **current page only** — the reported `totalResults` still reflects the
server-side filters. Industry and dissolved-entity exclusion filters are still
**not** implemented.

### Detail — `getCompany()`

`getCompany(companyId)` GETs `/v1/company/{id}` and maps the raw response into
`RegisterCompanyDetail` via the pure `normalizeCompany()`
(`src/modules/register/openregister.ts`, `src/modules/register/types.ts`).
Transport: 15 s timeout, `429 → RegisterCreditError`, `404 → null`, other
non-2xx → `RegisterRequestError`.

### Financial parsing — `extractSearchFinancials()`

Pure function in `src/modules/register/openregister.ts` (unit-tested in
`tests/unit/register-financials.test.ts`):

- **Cents vs euro**: `indicators[]` monetary values are in **cents** and are
  divided by 100; the flat search-row fields (`net_income`, `revenue`) are
  already **euros** and are used as-is.
- **Source preference**: prefers the latest `indicators[]` entry (by `date`),
  falling back to the flat row fields.
- **Sign is preserved**: a loss stays negative; a positive result stays
  positive.
- **Missing ≠ 0**: absent figures stay `null` and are never coerced to `0`; a
  genuine break-even `0` is preserved.
- **Reporting year + source**: `fiscalYear` is derived from the indicator
  `date` (or the flat `fiscal_year`), and `financialsSource` records the origin
  and unit (`"indicators"` | `"search_row"`), or `null` when no figures exist.

### Representative extraction — `normalizeRepresentatives()`

Pure function in `src/modules/register/openregister.ts` (tested in
`tests/unit/register-normalize.test.ts`):

- Drops former officers (any `end_date`).
- Keeps natural persons only (legal-person officers cannot become a lead).
- Flags managing directors via substring hints on the role
  (`director`, `geschaeft/geschäft`, `vorstand`, `inhaber`, `managing`,
  `owner`) and sorts them first.

The import picks the first managing director, else the first current
representative, else falls back to the company itself as the lead
(`src/modules/register/actions.ts`).

### NOT implemented in-app (do not assume it exists)

- Website / Impressum scraping.
- MailCom (or any) phone scoring / enrichment waterfall.
- Python enrichment runner integration (see §6).
- Regional/legal-form discovery filters, `seen_ids` skip files, resume-after-
  interruption checkpoints.

---

## 2. Deduplication rules

Both employer and lead are deduped on the Handelsregister company id.

- **Employer**: `resolveEmployerId()` reuses an existing employer for
  `(tenant_id, register_id)`; the unique index `employers_tenant_register_idx`
  (partial, `register_id is not null`) is the DB guard
  (`src/db/schema/employers.ts`).
- **Lead (`participants`)**: deduped on `participants.register_id` via the
  partial unique index `participants_tenant_register_idx`
  (`src/db/schema/participants.ts`). The insert uses
  `onConflictDoNothing` on `(tenant_id, register_id)` so a concurrent re-import
  cannot create a duplicate.

### Outcome semantics (`ImportOutcome`)

Defined in `src/modules/register/import-run.ts`, produced in
`src/modules/register/actions.ts`:

| Outcome | Meaning |
|---|---|
| `inserted` | Brand-new lead created for this `register_id`. |
| `updated` | Existing lead had empty register-derived fields gap-filled. |
| `skipped` | Lead already exists and nothing needed refreshing (or a concurrent insert won the race). |
| `conflicted` | A lead for this `register_id` exists but is linked to a **different** employer — left untouched for manual review. |

The outcome is surfaced to the user via `redirect("/pipeline?import=<outcome>")`
and rendered as a banner (`src/app/(internal)/pipeline/page.tsx`).

### Conservative gap-fill / source priority

`refreshExistingLead()` (`src/modules/register/actions.ts`) only fills fields
that are still **empty** — `employerId` (if null), `city` (if null and a value
is available), `eligibilityNotes` (if null). It **never overwrites** a non-empty
field, so consultant edits always win over a re-import (existing/manual data has
priority; the import is strictly additive). If nothing is empty → `skipped`.

---

## 3. Data provenance

What is persisted about an imported record:

- **Employer** (`employers`): `source = "openregister"`, plus `register_id`,
  `register_number`, `register_type`, `register_court`; company contact
  email/phone land on `contactEmail` / `contactPhone`.
- **Participant** (`participants`): `source = "openregister"`, `register_id`
  (dedup key), and `import_run_id` — set on the **created or updated** lead only
  (never on `skipped` / `conflicted`). The discovery loss signal is now also
  persisted as **structured columns** — `net_income` (`numeric(14,2)`,
  sign-safe, nullable), `financial_year` (`integer`), and `financials_source`
  (`text`: `indicators` | `search_row`) — mapped from the discovery criteria by
  the pure `buildFinancialColumns()` (`src/modules/register/import-run.ts`) and
  written in `insertLead` / gap-filled in `refreshExistingLead`
  (`src/modules/register/actions.ts`). A missing figure stays `null` (**never
  coerced to 0**); a genuine break-even `0` is preserved. These columns are
  additive to — not a replacement for — the human-readable
  `eligibility_notes` text, and are surfaced read-only on the lead detail page
  (`src/app/(internal)/leads/[id]/page.tsx`).
- **Import run** (`import_runs`): `source`, `status`, `criteria` (jsonb),
  `stats` (jsonb), `started_by_user_id`, `started_at`, `finished_at`, `error`
  (see §5).

### Provenance gaps (honest)

- **Structured financials are now persisted (gap closed).** `financials_source`
  plus the loss figure (`net_income`) and reporting year (`financial_year`) are
  written to real, nullable `participants` columns at import (see above), in
  addition to the human-readable `eligibility_notes` text. Revenue is still not
  stored as a structured column (the free-text note remains the only place a
  revenue figure appears); no per-field confidence is modelled.
- **Imported leads have no participant phone.** The company phone is stored on
  the employer; `participants.phone` / `participants.phone_normalized` are left
  null at import. `phone_normalized` (see `src/modules/participants/phone.ts`)
  is populated by later contact-update / messaging flows, not by the import.
- **No per-field confidence** is modelled anywhere (no field-level provenance,
  score, or "last verified" metadata).

---

## 4. Pipeline statuses

Real `participant_status` enum values, in canonical order — from
`src/db/schema/enums.ts` (`PIPELINE_STATUS_ORDER` in
`src/modules/participants/queries.ts` is exactly this enum order):

```
new → called → not_reachable → wrong_number → interested → not_interested →
eligibility_unclear → employer_pending → qualified → test_phase →
documents_phase → application_phase → enrolled → lost
```

Semantic groupings used by the pipeline (`src/modules/participants/pipeline-filter.ts`):

- **Open** (`OPEN_STATUSES`): everything except the terminal drop-outs
  (`lost`, `not_interested`) and the won end-state (`enrolled`).
- **Reached** (`REACHED_STATUSES`): statuses only reachable after an actual
  conversation — `interested`, `not_interested`, `eligibility_unclear`,
  `employer_pending`, `qualified`, `test_phase`, `documents_phase`,
  `application_phase`, `enrolled`.
- **Qualified+** (`QUALIFIED_PLUS_STATUSES`): `qualified` … `enrolled`.
- **Application+** (`APPLICATION_PLUS_STATUSES`): `application_phase`,
  `enrolled`.
- **Unreachable** (`UNREACHABLE_STATUSES`): `not_reachable`, `wrong_number`.

### Availability gate

`availability_status` (`yes`, `probably_employer_pending`, `partial`,
`not_possible`, `unclear` — `src/db/schema/enums.ts`) is the mandatory
20h/week × 6-month gate. It is enforced at status-transition time
(`changeParticipantStatus` → `AvailabilityGateError`, see
`docs/ARCHITECTURE.md`), not in the pipeline read model. "Qualified+" therefore
means the availability gate has been cleared.

---

## 5. KPI definitions (Pipeline page)

All KPIs are pure functions in `src/modules/participants/pipeline-filter.ts`,
computed over the **current pipeline filter** (status set, consultant/unassigned,
source, phone/email presence, free-text search, and the `createdFrom`/
`createdUntil` range on `participants.created_at`). The aggregate and list
queries share `buildPipelineConditions`, so KPI counts and the list can never
disagree.

- **`rate(numerator, denominator)`** = one-decimal percentage,
  `round(n/d * 1000) / 10`; `null` when the denominator is 0 (rendered `—`).
- **Total** = all leads matching the current filter (the denominator/date range
  for every "of N" KPI is this filtered total).

`deriveKpis()` (numerator → denominator):

| KPI | Numerator | Denominator |
|---|---|---|
| Total | filtered leads | — |
| Needs first call | `new` | — |
| **Reached** | `REACHED_STATUSES` sum | total |
| Interested | `interested` | — |
| Qualified+ | `QUALIFIED_PLUS_STATUSES` sum | total |
| Employer pending | `employer_pending` | — |
| Unreachable | `not_reachable + wrong_number` | — |
| Application+ | `application_phase + enrolled` | — |
| Lost | `lost + not_interested` | total |
| Phone coverage | `phone_normalized` present | total |
| Email coverage | `email` present | total |

**Corrected "reached" vs the old "contacted".** The retired metric defined
`contacted = status <> 'new'`, which counted mere attempts (and bad data) as
contact. **Reached** instead counts only statuses a lead can be in *after* a
qualifying conversation actually happened — `new`, `called`, `not_reachable`,
and `wrong_number` are attempts, not confirmed reach, and are deliberately
excluded (`REACHED_STATUSES` in `pipeline-filter.ts`).

`computeConversions()` builds an adjacent-stage funnel, each step an explicit
numerator/denominator: `worked = total − new` (of total) → `reached` (of
worked) → `qualified+` (of reached) → `application+` (of qualified+) →
`enrolled` (of application+). Here the total is `totalFromCounts()` (sum of the
grouped status counts for the same filter).

### Import freshness strip

`getImportFreshness()` (`src/modules/participants/pipeline.ts`) reads
`import_runs` for the strip: last **completed** run's `finished_at` + `stats`,
plus counts of `running` and `failed` runs. Before Task A nothing wrote to
`import_runs`, so the strip showed an empty state; the import now populates it
(see §5.1).

### 5.1 What the import writes to `import_runs`

`importCompany` (`src/modules/register/actions.ts`) records **one run row per
invocation** (a per-company batch of size one — the honest granularity for a
per-company action; helpers live in `src/modules/register/import-run.ts`):

- **Success**: a single tenant transaction opens the run (`status = running`),
  does the employer/lead work, stamps `participants.import_run_id`, then closes
  it as `status = completed` with real counters
  `{inserted, updated, skipped, conflicted}` where **exactly one** counter is
  `1` for that company (`tallyOutcome`, unit-tested in
  `tests/unit/import-run.test.ts`). Because the run row and lead commit
  atomically, a partial/`running` row is never left behind on success.
- **Failure**: if the register fetch throws, the DB work throws, or the company
  is not found, a separate `status = failed` row is written (with a capped
  `error` string) via `recordFailedRun`. A failed import is **never** recorded
  as `completed`, and the counters always reflect the real DB result — never a
  blanket "everything = inserted".

### 5.2 Batch import (`importCompanies`)

The discovery page can import **every company on the current page in one go**
(`importCompanies` in `src/modules/register/actions.ts`). It writes **exactly one**
`import_runs` row for the whole batch, with the aggregate stats
`{discovered, inserted, updated, skipped, conflicted, failed}` (`tallyBatch`,
unit-tested in `tests/unit/import-run.test.ts`). Each company is applied under
the shared run id in its **own** tenant transaction (`applyCompanyToRun`); a
per-company fetch/import failure or not-found is counted as `failed` and does
**not** abort the batch, so the run still closes as `completed` with an honest
`failed` count. `criteria` records the discovery filters
(`employeesMin/Max`, `federalState`, `legalForms`, `page`) plus `discovered`.

---

## 6. Import / enrichment execution contract (target — NOT integrated)

The Python enrichment runner is **not integrated into this app today**. It lives
in sibling repositories (e.g. `lead_generation_pipeline-streamlined/`,
`lead-generation-app/`) outside `sales-automation`. A repo-wide grep for
`python` / enrichment runner turns up **no** references in `src/`. The section
below is the **target contract** for a future bridge, not a description of
current behavior.

When/if a runner is bridged in, it should honor:

- **Fatal errors raise and exit non-zero** — no silent success on failure.
- **Exactly one machine-readable sentinel JSON line** on stdout carrying the
  run result, e.g.:

  ```json
  {"out_csv": "...", "callsheet_path": "...", "summary_path": "...", "total": 0, "matched": 0, "unmatched": 0}
  ```

- The caller **uses the returned `out_csv` path**, never a "latest CSV in a
  directory" heuristic.
- The result maps cleanly onto an `import_runs` row (`source`, `status`,
  `criteria`, `stats`, `error`) so the same freshness strip / run history works
  for batch imports.

---

## 7. Required environment variables

Only variables actually read by the code are listed (grep-verified). No
`GOOGLE_PLACES*` or `APOLLO*` variables are referenced anywhere in `src/`.

| Variable | Required | Read in | Purpose |
|---|---|---|---|
| `DATABASE_URL` | yes | `src/lib/env.ts`, `src/db/client.ts` | RLS-enforced app-role connection. |
| `MIGRATION_DATABASE_URL` | optional | `src/lib/env.ts`, `src/db/seed.ts`, `src/jobs/worker.ts` | Owner connection for migrations/seed/worker. |
| `AUTH_SECRET` | yes (≥16) | `src/lib/env.ts`, `src/modules/auth/session.ts` | Signs internal session cookies. |
| `TOKEN_SECRET` | yes (≥16, ≠ AUTH_SECRET) | `src/lib/env.ts`, `src/modules/tokens/service.ts` | Signs external magic-link tokens. |
| `APP_BASE_URL` | optional (default `http://localhost:3000`) | `src/lib/env.ts`, `src/modules/tokens/service.ts` | Base URL for magic links. |
| `OPENREGISTER_API_KEY` | optional | `src/lib/env.ts`, `src/modules/register/index.ts` | Enables the live OpenRegister provider (else mock). |
| `OPENREGISTER_BASE_URL` | optional (default `https://api.openregister.de`) | `src/lib/env.ts` | OpenRegister API base. |
| `WHATSAPP_ACCESS_TOKEN` | optional | `src/modules/messaging/adapters.ts` | With `WHATSAPP_PHONE_NUMBER_ID`, enables live WhatsApp. |
| `WHATSAPP_PHONE_NUMBER_ID` | optional | `src/modules/messaging/adapters.ts` | With `WHATSAPP_ACCESS_TOKEN`, enables live WhatsApp. |
| `WHATSAPP_API_VERSION` | optional (default `v21.0`) | `src/modules/messaging/adapters.ts` | Meta Graph API version. |
| `RESEND_API_KEY` | optional | `src/modules/messaging/adapters.ts` | With `RESEND_FROM_EMAIL`, enables live email. |
| `RESEND_FROM_EMAIL` | optional | `src/modules/messaging/adapters.ts` | With `RESEND_API_KEY`, enables live email. |
| `APTITUDE_TEST_BASE_URL` | optional | `src/modules/aptitude-tests/config.ts` | External aptitude-test launch URL. |
| `PROVIDER_CITY` | optional (default `Böblingen`) | `src/modules/documents/generate.ts` | Provider city stamped onto generated PDFs. |

`NODE_ENV` is read for standard dev/prod branching (`src/db/client.ts`,
`src/modules/auth/session.ts`). `.env.example` documents all of the above;
`PROVIDER_CITY` was added there for parity with the code.

---

## 8. WhatsApp messaging usage

Manual, consultant-initiated send: `sendTaskWhatsApp(formData)` in
`src/modules/tasks/actions.ts` (session-guarded, tenant-scoped). It resolves the
task's recipient (`resolveRecipient`), then dispatches via `sendTaskMessage`
using the existing `task_<type>` templates — no new template infrastructure.

- **Demo-safe mock vs live**: `resolveAdapterMode("whatsapp")`
  (`src/modules/messaging/adapters.ts`) returns `live` only when **both**
  `WHATSAPP_ACCESS_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID` are set; otherwise the
  `MockAdapter` just logs — no network call, demo stays open.
- **Consent gate (live only)**: in live mode, for **participant** recipients,
  the send requires a current `whatsapp_optin` consent — `hasWhatsAppOptIn`
  reads the latest `consent_records` row for the participant. In mock/demo mode
  the consent gate does not apply.
- **Outcomes**: the action redirects to `/tasks?wa=<outcome>` with
  `ok | no_phone | no_consent | not_applicable | failed`. A missing/
  unnormalizable phone (`src/modules/participants/phone.ts`) yields `no_phone`
  before any send is attempted.

Enabling live mode: set `WHATSAPP_ACCESS_TOKEN` + `WHATSAPP_PHONE_NUMBER_ID`
(optionally `WHATSAPP_API_VERSION`). Note: imported leads have no participant
phone by default (§3), so a WhatsApp send to a freshly imported lead needs a
phone captured first.

### Delivery receipts & inbound (webhook)

A live WhatsApp send records its provider message id in `message_deliveries`
(migration `0010`, RLS-consistent). The Meta Cloud API webhook
(`src/app/api/webhooks/whatsapp/route.ts`) then reconciles state: delivery/read/
failed receipts advance `message_deliveries.status` monotonically
(`sent → delivered → read`, `failed`) via the pure
`src/modules/messaging/delivery-status.ts`, and an inbound reply reopens the
participant's 24h session window (`participants.whatsapp_window_expires_at`).
The `GET` verify-token handshake and `POST` HMAC-SHA256 signature check are
gated on `WHATSAPP_WEBHOOK_VERIFY_TOKEN` / `WHATSAPP_APP_SECRET`; without them
the route is inert. Reconciliation runs on the trusted owner connection
(`src/db/system-client.ts`) since a signed Meta callback carries no tenant. In
demo/mock mode no provider id is issued, so nothing is written.
