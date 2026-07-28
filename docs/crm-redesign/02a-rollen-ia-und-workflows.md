# CRM Rollen, Information Architecture & End-to-End Workflows
## German QCG Sales Operations CRM Redesign — Phase 2a

**Last Updated:** July 28, 2026  
**Audience:** Product, Engineering, Design, Operations  
**Status:** Design Plan — Pending Owner Decisions & P1 Fix

---

## Executive Summary

This document establishes operational personas, proposes the information architecture (nav, sections, search, notifications, sitemap), and maps end-to-end workflows for all CRM operations. It identifies current technical limitations (consultant record ownership not enforced at query level, concurrent message approval race condition allowing double-dispatch) and defers role-aware navigation decisions to the owner pending clarification of tenant collaboration strategy.

**Key Decisions Pending:** Whether to enforce assigned-record-only visibility per consultant or maintain tenant-wide operational transparency.

**P1 Blocker:** Concurrent message approval race condition (§7.2) causes double-send of messages; requires atomic compare-and-set fix before production use of concurrent approvers.

---

## 1. Personas: Technical Roles → Operational Roles

### 1.1 Current Technical Role Model

**Source:** `src/modules/auth/session.ts` (lines 14–20, 58)

```typescript
export type SessionUser = {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  role: "consultant" | "admin";  // Only two roles
};
```

**Current State:**
- Only `"consultant"` and `"admin"` roles exist in the system.
- No explicit permissions matrix; access decisions are role-based or implicit.
- Consultant record ownership is **NOT enforced**—consultants see all tenant records.
- Admin shows/hides the "Register-Import" nav item only (src/app/(internal)/layout.tsx lines 26–28).

### 1.2 Proposed Operational Personas

**Owner Decision Approved:** Implement three internal roles — `consultant`, `manager`, `admin`. No separate operations role initially; operations/backoffice responsibilities use manager permissions.

| Persona | Technical Role | Responsibilities | Record Visibility | Edit Scope | UX Needs |
|---------|----------------|-------------------|-------------------|-----------|----------|
| **Berater** (Consultant) | `consultant` | Lead qualification, outreach, appointment scheduling, task workflow management | **Assigned records + unassigned team pool (claim allowed)** | Own assigned leads/tasks; can claim unassigned | My Pipeline, Quick Actions, Recent Items |
| **Geschäftsführer** (Manager) | `manager` | Team management, pipeline oversight, message approvals, task escalations, import QA, performance reporting | Tenant-wide | Limited: escalate, reassign, flag, approve messages | Manager Dashboard (team pipeline, lead aging, consultant workload, task SLA, messaging outcomes, audit signals) — Planned Phase 1+ |
| **Admin** | `admin` | Register import, user management, audit review, emergency interventions, system configuration | Tenant-wide | Full: users, rules, templates, all operations | All features, Audit Trail, System Health |

### 1.3 Current Visibility & Ownership Limitations (Phase 0 Backend Prerequisite)

**Owner Decision Approved:** Enforce assigned-record-only visibility for consultants + controlled unassigned team pool they may claim. Managers/admins see all records within the tenant. Enforce via centralized server-side authorization/query scopes, not UI filters. RLS remains tenant boundary.

**Current State:**
- Consultant record ownership is **NOT enforced**: consultants see all participants in the tenant, even if they don't own the record.
- Database RLS scopes queries to tenant only; no per-consultant row filtering exists.
- Task ownership via `task.owner_user_id`, but consultants cannot restrict their view to only their own tasks.

**Phase 0 Backend Work Required:**
- Define safe claim/reassignment rules (who can claim? who can reassign to whom?)
- Manager override semantics (can manager reassign consultant's record? Yes/no policy?)
- Audit events: log claim, reassignment, manager override actions
- Test requirements: concurrent claim attempts, reassignment race conditions, RLS policy verification

**Related Files:**
- `src/modules/audit/log.ts` — Logs include actor, subject, event; visibility constraints to be added.

### 1.4 Record Visibility Model (Owner Decision Approved)

**Approved Decision:** Consultants see assigned records + unassigned team pool (claim allowed); managers/admins see all.

#### Implementation Strategy (Backend Phase 0)

**Consultant Query Scopes:**
- Assigned: `WHERE owner_user_id = current_user_id`
- Team Pool: `WHERE owner_user_id IS NULL AND tenant_id = current_tenant_id` (unassigned, visible for claim)
- Manager/Admin: No per-consultant filter; all tenant records visible

**Claim/Reassignment Rules:**
- Consultant can claim unassigned record: `UPDATE participants SET owner_user_id = ? WHERE owner_user_id IS NULL AND id = ? AND tenant_id = ?`
- Manager can reassign record between consultants: `UPDATE participants SET owner_user_id = ? WHERE id = ? AND tenant_id = ?` (audit logged)
- Consultant cannot reassign own record to another consultant (manager override only)

**Audit Trail:**
- Log: "Consultant claimed record [id]"
- Log: "Manager reassigned [record] from [consultant A] to [consultant B]"

**Navigation Impact:** Sidebar visibility already prepared for conditional role display; no UI changes needed until Phase 1.

---

## 2. Proposed Information Architecture

### 2.1 Global Navigation Structure

```
┌─────────────────────────────────────────────────────────────┐
│ QCG | Sales Operations                                   [👤]│
└─────────────────────────────────────────────────────────────┘
  │
  ├─ PRIMARY NAVIGATION (Main Sections)
  │  ├─ 📊 Pipeline         (Lead management, filters, bulk actions)
  │  ├─ ✓ Tasks             (Outbound task queue, link management)
  │  ├─ 📤 Outbox           (Message approval queue)
  │  ├─ 📅 Appointments     (Scheduled events, status updates)
  │  ├─ 🏢 Employers        (Company setup, BA data)
  │  ├─ 📄 Documents        (Participant document checklist)
  │  ├─ 📝 Applications     (Qualification app tracking)
  │  └─ 📈 Reports          (KPIs, funnel, analytics)
  │
  ├─ SECONDARY NAVIGATION (Admin Only)
  │  ├─ ⚙️  Register Import  (Admin-only bulk lead import)
  │  └─ 📋 Settings         (Users, templates, rules — future)
  │
  └─ USER MENU
     ├─ [Name] | Beratung / Verwaltung
     ├─ Einstellungen
     └─ Abmelden
```

**File References:**
- Layout: `src/app/(internal)/layout.tsx` (lines 1–58)
- Navigation component: `src/components/internal/SidebarNav.tsx`
- Admin-only item: `src/app/(internal)/layout.tsx` (lines 26–28)

**Proposed Enhancements (Design Only; Not Implemented):**
1. Breadcrumbs below main nav (route context)
2. Search / Command Palette (⌘K / Ctrl+K) — future
3. Notifications bell (pending alerts, escalations — future)
4. Recent items (last 5 records viewed — future)

### 2.2 Section-Level Architecture

#### Section: Pipeline (/pipeline)
- File: `src/app/(internal)/pipeline/page.tsx` (400+ lines)
- Table: `src/components/internal/PipelineTable.tsx`
- Filters: `src/components/internal/PipelineFilters.tsx`

**Sub-Architecture:**
- KPI Strip: Total Leads, Qualified, In Application, Conversion %
- Alert Bar: Import stale, Escalations pending
- Saved Filter Presets (Erstkontakt offen, Nicht erreichbar, etc.)
- Search & Advanced Filters
- Lead Table (Sortable, Selectable, Bulk Actions)

#### Section: Tasks (/tasks)
- File: `src/app/(internal)/tasks/page.tsx`
- Button: `src/app/(internal)/tasks/task-whatsapp-button.tsx`

**Sub-Architecture:**
- Task List (Vertical stack, by due date or creation)
- Task Card: Status Badge, Title, Participant, Owner, Due Date
- Link Status: [Generate] [Revoke] [Copy]
- WhatsApp: [Draft] [Send] [Revoke]
- State Feedback & Keyboard Shortcuts

#### Section: Outbox (/outbox) — Message Approval Queue
- File: `src/app/(internal)/outbox/page.tsx`
- Service: `src/modules/messaging/outbox.ts` (lines 72–107: listPendingMessages)

**Sub-Architecture:**
- Message Card (Approval Decision Queue)
- Channel Badge, Recipient, Template Key, Body Preview
- [Full Preview] Button to expand
- Action: [Approve] [Reject + Reason] [Cancel]
- Summary: Pending count, Sent count, Rejected count

#### Section: Appointments (/appointments)
- File: `src/app/(internal)/appointments/page.tsx`

**Sub-Architecture:**
- Calendar View (Future; currently data-list)
- Data List: Date | Time | Participant | Type | Status
- Inline Actions: [Complete] [No-Show] [Reschedule]
- Filter: Date Range, Status

#### Section: Employers (/employers)
- File: `src/app/(internal)/employers/page.tsx`
- Setup wizard: `src/components/task-pages/employer/SetupAssistant.tsx`

**Sub-Architecture:**
- Data Table: Company Name | Status | Contact | Last Updated
- Status: Setup Pending, Betriebsnummer Collected, AGS Confirmed, Complete
- Setup Wizard (Inline modal, 4 steps)
- Bulk Actions: Export

#### Section: Documents (/documents)
- File: `src/app/(internal)/documents/page.tsx`

**Sub-Architecture:**
- Participant Document Checklist
- Items: Identity Card, Proof of Address, Educational Credentials, BA Form
- Status per item: Pending, Received, Verified, Rejected
- Export: Compliance checklist for audit

#### Section: Applications (/applications)
- File: `src/app/(internal)/applications/page.tsx`

**Sub-Architecture:**
- Data Table: Participant | Date Started | Status | Ready? | Blockers
- Status: In Progress, Ready, Submitted, Approved, Rejected
- Blocker Examples: Missing Docs, Incomplete BA Data, Pending Signature
- Bulk Actions: Export Ready Batch

#### Section: Reports (/reports)
- File: `src/app/(internal)/reports/page.tsx`

**Sub-Architecture:**
- KPI Dashboard: Leads, Qualified, In Application, Approved
- Conversion Rate, Funnel Efficiency, Avg. Days, No-Show Rate
- Funnel Visualization (Vertical stages)
- Filters: Date Range, Consultant, Source
- Export: PDF/CSV

---

## 3. End-to-End Workflow Maps

### 3.1 Company Discovery & Lead Import

**Workflow Type:** Batch operational. Admin-initiated, consultant-viewed.

**Current Implementation:**
- File: `src/app/(internal)/leads/import/page.tsx`
- Service: `docs/REGISTER-IMPORT.md` (§1–§5)
- Database: `drizzle/migrations/0007-register-import.sql` (import runs, dedup logic)

**Workflow:**
1. [ADMIN] Navigate to /leads/import (admin-only nav check)
2. [ADMIN] Upload CSV / Initiate Import
3. [SYSTEM] Parse & Deduplicate
   - Match on (tenant_id, register_id)
   - For each row: inserted | updated | skipped | conflicted
   - Create import_run row with real counts
4. [ADMIN] Review Import Results
   - Summary: +42 new | 5 updated | 8 skipped | 1 conflict
5. [CONSULTANT] View New Leads in Pipeline
   - Import-freshness strip alerts (stale > 7 days)
6. [END] Leads ready for outreach

**State Feedback:**
- "Import complete: 42 new leads, 5 updated, 1 conflict. [Review Conflicts]"

---

### 3.2 Lead Qualification & Discovery

**Workflow Type:** Individual outreach. Consultant-initiated.

**Current Implementation:**
- Lead Create: `src/app/(internal)/leads/new/page.tsx`
- Lead Detail: `src/app/(internal)/leads/[id]/page.tsx`
- Schema: `src/db/schema/participants.ts` (lines 31–40: name, email, phone, source)

**Workflow:**
1. [CONSULTANT] Create Lead (Manual) or Lead auto-imported from OpenRegister
2. [CONSULTANT] View Lead Detail Page
   - Overview section (name, contact, source, status)
   - Eligibility section (financial data, notes, employment status)
   - Activities section (tasks, notes, audit trail)
3. [CONSULTANT] Assess Eligibility
   - Financial trigger: "Jahresüberschuss < €50k"
   - Availability gate: 20h/week × ~6 months
   - Set status: "qualified" or "rejected" with reason
4. [IF QUALIFIED] Create Contact Task
   - System auto-routes task
   - Task type: "first_contact" or "inbound_call"
5. [CONSULTANT] Send Outreach Message
   - WhatsApp via magic link, email, or SMS
   - Queued for approval → Outbox
6. [END] Lead in active outreach pipeline

**State Feedback:**
- After create: "Lead created: Müller, Anna. [View] [Create Task]"
- After qualify: "Status updated to Qualified. Eligibility gates passed."

---

### 3.3 Participant / Employer Onboarding

**Workflow Type:** Multi-step funnel. Participant-initiated via magic links.

**Current Implementation:**
- Participant Setup: `src/modules/participants/external-actions.ts`, `src/modules/participants/actions.ts`
- Employer Setup: `src/components/task-pages/employer/SetupAssistant.tsx`
- Task Definitions: `src/db/schema` task types (start_aptitude_test, confirm_details, etc.)

**Workflow Phases:**
1. [PHASE 1: PARTICIPANT DETAILS]
   - Route task: "confirm_details" with magic link
   - Participant fills form: name, dob, street, postal_code, city
   - Status transitions on auto-completion

2. [PHASE 2: AVAILABILITY CHECK]
   - Confirm availability: 20h/week × 6 months?
   - If yes: route "start_aptitude_test"; If no: mark ineligible

3. [PHASE 3: APTITUDE TEST]
   - Participant starts test (multi-use link scope)
   - May re-open link until test complete

4. [PHASE 4: EMPLOYER DATA]
   - Setup wizard (4 steps): Contact → Betriebsnummer → AGS → Work Model
   - Consultant can manual step-through if incomplete

5. [PHASE 5: CONSENT & SIGNATURES]
   - WhatsApp opt-in, Data processing, Program agreement signature

**Multi-Use Scopes (Intentional):**
- `start_aptitude_test`, `employer_setup*` — participant can re-open link without burning it.

**State Feedback:**
- "Magic link issued for Müller. [Copy] [Revoke]"
- "Task started: confirm_details"
- "✓ Details confirmed. Next: Availability assessment."

**Known Blocker:**
- **Missing:** Consultant ownership authorization check. Consultants currently unrestricted in editing any participant record (§1.3).

---

### 3.4 Tasks & Follow-Ups

**Workflow Type:** Internal task queue. System-routed or consultant-created.

**Current Implementation:**
- Task System: `src/modules/tasks` (actions, queries, status)
- Task Routing: `src/jobs/worker.ts` (routing engine, escalation)
- Task Status: `src/db/schema` enum + `src/modules/tasks/status.ts`

**Task Lifecycle:**
1. [TRIGGER] Task created by system or consultant
2. [STATE: PENDING] Task queued, awaiting consultant action
3. [CONSULTANT ACTION]
   - [A] Mark Done (closes task)
   - [B] Issue Magic Link (for external task)
   - [C] Send via WhatsApp (queue to Outbox)
   - [D] Revoke Link (invalidate all live tokens)
   - [E] Reassign Task (change owner_user_id)
4. [OVERDUE AUTO-ESCALATION] Worker detects SLA breach
   - Set escalation_at timestamp (once per task)
   - Route follow-up task to admin
5. [CLOSED STATES] done, closed_by_system, cancelled

**State Feedback:**
- "New task: Confirm Details for Müller. [View] [Create Link]"
- "Link ready: [Copy] [Revoke]"
- "⚠ This task is 2 days overdue. [Escalate] [Reassign]"

---

### 3.5 WhatsApp Drafting, Approval & Send

**Workflow Type:** Asynchronous message dispatch. Consultant drafts, approver sends.

**Current Implementation:**
- Enqueue: `src/modules/tasks/actions.ts` → `sendTaskWhatsApp` (lines 138–200)
- Outbox Service: `src/modules/messaging/outbox.ts` (lines 21–69: enqueueTaskMessage, lines 130–189: approveAndDispatch)
- Approval Gate: `src/app/(internal)/outbox/page.tsx`
- **Known Race Condition (P1):** Two users can approve the same message concurrently; both may call adapter.send(), resulting in double-dispatch (see §7.2).

**Workflow:**
1. [CONSULTANT] Clicks [Send WhatsApp] on task
2. [BACKEND] sendTaskWhatsApp()
   - Resolve recipient (phone from participant)
   - Check WhatsApp consent (live mode only)
   - Render template (task_{type} with {{link}} injected)
   - For magic_link tasks: getOrIssueMagicLinkForTask()
   - Create outboundMessage row: status="pending_approval", created_by=current_user
3. [FEEDBACK] "Message queued for approval. See Outbox."
4. [APPROVER] Navigate to /outbox, see pending message card
5. **[SEPARATION OF DUTIES CHECK]** Only manager/admin can approve (creator cannot approve own message)
6. [APPROVER DECISION]
   - [A] APPROVE: approveAndDispatch() → Send & log "message_approved"
   - [B] REJECT: rejectOutboundMessage() → Store reason, log "message_rejected"
   - [C] CANCEL: cancelOutboundMessage() → Mark cancelled, log "message_cancelled"

**Known Blocker (P1 — MANDATORY FIX BEFORE PRODUCTION):**
- **Concurrent Message Approval Race Condition:** Two users approve the same message simultaneously. Both read "pending_approval" status before either updates. Both proceed through adapter.send(), resulting in **double-dispatch of the same message to the recipient**. Solution requires atomic compare-and-set (UPDATE WHERE id + tenantId + status='pending_approval') to ensure only one winner calls adapter. See §7.2 for full details.

**Phase 0 Schema Changes Required:**
- Add `created_by` / `requested_by` field to outbound_message table (track creator for separation of duties check)
- Implement atomic approval CAS in approveAndDispatch (P1-1 fix)

---

### 3.6 Magic Links & Document Signatures

**Workflow Type:** External participant verification. Time-limited, single-use or multi-use by scope.

**Current Implementation:**
- Magic Link Service: `src/modules/tokens/service.ts`
- Token Validation: `src/app/t/[token]/page.tsx`
- Document Signature: `src/modules/signatures/actions.ts`
- Priority-1 Fixes: See `docs/plan.md` §0c (F1–F5 all implemented this cycle).

**Lifecycle:**
1. [ISSUANCE] getOrIssueMagicLinkForTask(tx, task)
   - Mint JWT: {jti, sub, tid, scope, iat, exp}
   - Hash token, store only hash + expiry in db
   - Revoke any prior token for (task_id, scope)
2. [DISTRIBUTION] Consultant sends link via WhatsApp/SMS/Email
3. [CLICK & VALIDATION] Participant clicks link
   - Verify JWT signature, expiry (48h default)
   - Hash JWT, look up in db
   - Check token unused (used_at IS NULL)
   - Check task active (EXCEPT multi-use scopes)
4. [MULTI-USE SCOPE HANDLING]
   - Scopes: start_aptitude_test, provide_betriebsnummer, confirm_ags_status, confirm_time_model
   - Link survives task close
5. [PARTICIPANT ACTION] Submit form
6. [TOKEN BURN] Atomic check-and-set
   - SQL: UPDATE magic_link_tokens SET used_at = NOW() WHERE id = $1 AND used_at IS NULL
7. [SIDE EFFECTS] After successful burn
   - Close task, Route next task, Log activity
8. [REVOCATION] Consultant can manually revoke
9. [EXPIRED LINK] After 48h: link returns 401

**State Feedback:**
- "✓ Link ready: [Copy] [Share via WhatsApp] [Revoke]"
- "✓ Task completed by Müller. Details confirmed."

---

### 3.7 Documents & Application Readiness

**Workflow Type:** Compliance tracking. Consultant monitors, participant uploads via magic link.

**Current Implementation:**
- Documents: `src/modules/documents/`
- Document Portal: `src/app/(internal)/documents/[participantId]/page.tsx`
- Application Tracking: `src/app/(internal)/applications/page.tsx`

**Workflow:**
1. [SYSTEM] Auto-create document checklist on onboarding
2. [PARTICIPANT] Upload documents via magic link
3. [CONSULTANT] Review uploads, [Verify] or [Reject] each item
4. [IF REJECT] Request replacement
5. [ALL VERIFIED] Application readiness gate passes
6. [END] Ready for BA submission

**State Feedback:**
- "✓ Document received: {filename}. [Download for Review]"
- "Application ready for submission. [Review] [Submit to BA]"

---

### 3.8 Exceptions & Escalation

**Workflow Type:** Override & management escalation.

**Current Implementation:**
- Escalation Worker: `src/jobs/worker.ts` (lines 276–281)
- Task Status Override: Consultant can cancel/reassign
- Audit Trail: `src/modules/audit/log.ts`

**Exception Types:**
- Overdue Task: Worker detects SLA breach, marks "escalated", routes to admin
- Participant Ineligible: Set status = "rejected", auto-cancel tasks
- Out of Contact: Mark status = "inactive"
- Message Send Failure: WhatsApp adapter error, Status = "failed"
- **Concurrent Message Approval Race:** BLOCKER — results in double-send, not silent failure (see §3.5 & §7.2)

**State Feedback:**
- "⚠ Task escalated to {manager}"
- "Lead marked ineligible. Tasks cancelled."

---

### 3.9 Reporting & Performance Analytics

**Workflow Type:** Read-only executive & operational review.

**Current Implementation:**
- Reports Page: `src/app/(internal)/reports/page.tsx`
- Pipeline KPIs: `src/modules/register/pipeline.ts`
- Export: Pipeline CSV export route

**Workflow:**
1. Navigate to /reports
2. View KPI Dashboard: Leads, Qualified, In Application, Approved, Conversion %, Funnel
3. Filter by date range, consultant, source
4. Export as PDF/CSV for leadership

---

## 4. German Content Design Standards

### 4.1 Terminology Registry

| English Concept | German Standard | Example Usage |
|-----------------|-----------------|---------------|
| Consultant | Berater / Beraterin | "Berater: Schmidt, Marcus" |
| Lead | Interessent:in | "Interessenten-Pipeline" |
| Participant | Teilnehmer:in | "Teilnehmer: Müller, Anna" |
| Employer / Company | Arbeitgeber / Unternehmen | "Arbeitgeber: TechCorp GmbH" |
| Manager / Ops | Geschäftsführer:in / Teamleiter:in | Role badges |
| Status | Status | "Status: Qualifiziert" |
| Task | Aufgabe | "Neue Aufgabe: Termin bestätigen" |
| Message | Nachricht / Postnachricht | "Nachricht gesendet" |
| Appointment | Termin | "Termin: 2026-07-28 14:00" |
| Document | Dokument | "Dokument: Personalausweis" |
| Qualification Application | Qualifizierungsantrag | "Antrag eingereicht" |
| Approve / Reject | Genehmigen / Ablehnen | Buttons |
| Pending | Ausstehend | Status badge |
| Completed | Abgeschlossen | Status badge |
| No-Show | Nicht erschienen | "Nicht erschienen" |
| Escalation | Eskalation | "Eskaliert an: Admin" |
| Audit Trail | Prüfprotokoll | "Änderungen:" |

### 4.2 Status Label Design

| Status | German Label | Color | Context |
|--------|--------------|-------|---------|
| New | Neu | Blue | Lead/participant entered |
| Qualified | Qualifiziert | Green | Eligibility gates passed |
| Appointed | Termin vereinbart | Blue | Appointment scheduled |
| Onboarded | Eingearbeitet | Green | Details & consents collected |
| In Application | In Antrag | Orange | BA application in progress |
| Submitted | Eingereicht | Blue | Application sent to BA |
| Approved | Genehmigt | Green | BA approved |
| Rejected | Abgelehnt | Red | Ineligible or BA rejected |
| Inactive | Inaktiv | Gray | No contact or parked |
| No Contact | Nicht erreichbar | Red | Unable to reach |

### 4.3 Date & Number Format

- Display: `28.07.2026` (DD.MM.YYYY)
- Time: `14:30` (24-hour HH:MM)
- Currency: `€50.000,00` (comma decimal, dot thousands)
- Percentages: `45,2 %` (comma decimal, space before %)
- Phone: `+49 (123) 456789` (spaces for readability; store normalized)

### 4.4 Confirmation & Error Language

**Deletion Confirmation:**
```
"Wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden."
[Wirklich löschen] [Abbrechen]
```

**Error Language:**
```
❌ "Nachricht konnte nicht versendet werden: Ungültige Telefonnummer.
   Bitte Telefonnummer korrigieren und erneut versuchen."
```

**Success Language:**
```
✓ "Lead erstellt: Müller, Anna. [Jetzt konfigurieren]"
```

**Pending/Async Outcome:**
```
⧗ "Nachricht wird versendet... (kann einige Sekunden dauern)"
```

---

## 5. Cross-Workflow UX Rules

### 5.1 Provenance & Audit Trail

Every record carries immutable metadata (createdAt, updatedAt, audit log).

**Implementation:** `src/db/schema/helpers.ts` defines audit columns. `src/modules/audit/log.ts` records all actions.

### 5.2 Destructive Confirmations

Delete, revoke, escalate actions require explicit confirmation.

**Pattern:** Modal with "Wirklich fortfahren?" and default "Abbrechen" button.

### 5.3 Pending States & Async Feedback

Long operations show progress and prevent duplicate submission.

**Pattern:** Disable button, show spinner, replace text with "Wird {action}...", show error or success after.

### 5.4 Keyboard Navigation

**Shortcuts (Desktop):**
- `⌘K` / `Ctrl+K`: Open Command Palette
- `?`: Show Help
- `N`: Create New
- `G`: Generate Link
- `W`: Send WhatsApp
- `Space`: Toggle Selection
- `Escape`: Close Modal

### 5.5 Mobile Handoff & Responsive Design

- **Breakpoints:** Mobile < 640px, Tablet 640–1024px, Desktop > 1024px
- **Mobile:** Collapsible sidebar, bottom nav, large touch targets (44px)
- **Deep Links:** `/t/{jwt}?scope=confirm_details` works on mobile
- **Session:** 12h cookie persists across app switch

### 5.6 WCAG 2.2 AA Accessibility

- Interactive elements: `role`, `tabindex`, `aria-label`, `aria-describedby`
- Color not sole differentiator (icons + text)
- Contrast ≥ 4.5:1 for normal text
- Form labels linked to inputs
- Error messages linked to inputs
- Focus visible on keyboard nav

---

## 6. Navigation Hierarchy & Conditional Display

### 6.1 Sidebar Navigation (Current)

**File:** `src/app/(internal)/layout.tsx` (lines 16–29)

```typescript
const items = [
  { href: "/pipeline", label: t("pipeline") },
  { href: "/tasks", label: t("tasks") },
  { href: "/outbox", label: t("outbox") },
  // ... 8 more items ...
  ...(session.role === "admin"
    ? [{ href: "/leads/import", label: "Register-Import" }]
    : []),
];
```

### 6.2 Proposed Conditional Navigation (Design Only)

**Option A:** All consultants see all sections (current default).
**Option B:** Role-aware simplification (pending owner decision).

---

## 7. Known Current Blockers & Limitations

### 7.1 Consultant Record Ownership Not Enforced

**File:** `src/db/schema/participants.ts`

**Current State:**
- Consultants can see all tenant records.
- No RLS-level row filtering per consultant.
- Pipeline view shows all leads regardless of owner.

**Impact:** Feature Option B (Assigned-Record Restriction) requires database changes and RLS policy updates.

### 7.2 Concurrent Message Approval Race Condition (P1 Fix Required)

**File:** `src/modules/messaging/outbox.ts` (lines 130–189)

**Current State:**
The `approveAndDispatch()` function performs a non-atomic read-then-write:
1. Lines 134–142: SELECT by id + tenantId (no status filter in WHERE clause).
2. Line 144: `canApprove(row.status)` check in application code.
3. Lines 147–154: UPDATE status to "sending" by id only (no status compare-in-where).
4. Lines 169–189: Adapter.send() is called outside any transaction serialization boundary.

**Actual Race Condition Impact:**
Under concurrent READ COMMITTED requests, both transactions can:
- Read row status = "pending_approval" (lines 134–142)
- Pass the canApprove() check (line 144)
- Both execute UPDATE (lines 147–154)
- **Both call adapter.send() (line 180)** — resulting in **double-dispatch of the same message**.

This is not a silent failure; it is a data integrity bug: the same message gets sent twice.

**Blocker Description:**
- Consultant A clicks [Approve]
- Consultant B clicks [Approve] simultaneously
- Both read "pending_approval" status before either updates
- Both proceed through adapter.send() sequentially or concurrently
- Message sent twice (second send overwrites `sentAt`, `providerMessageId`, etc. in the same row, but delivery side-effects occur twice)

**Solution Required:**
Atomic compare-and-set before adapter call. The UPDATE must include status in the WHERE clause and return only on success (CAS winner); loser returns "not_pending" with clear error messaging. UI button disable is defense-in-depth only; it does not prevent the race if requests overlap during server processing.

### 7.3 Consultant Ownership Authorization Not Enforced

**Current State:**
- Internal actions (`src/modules/participants/actions-internal.ts`, `src/app/(internal)/pipeline/page.tsx`, `src/modules/participants/pipeline.ts`) run within `withTenant()` context — tenant boundary enforced by RLS at database level.
- No per-consultant assignment checks on internal pages; all consultant actions are tenant-scoped queries.
- External-facing actions (`src/modules/participants/external-actions.ts`) are participant-initiated via magic link (token-scoped, not consultant-scoped).

**Specific Implementation:** 
- Internal server actions in `src/modules/participants/actions-internal.ts` (lines 49–56) use `requireSession()` to verify login, then `withTenant(session.tenantId, ...)` to enforce tenant isolation.
- Pipeline page (`src/app/(internal)/pipeline/page.tsx`) and pipeline query layer (`src/modules/participants/pipeline.ts`, lines 13–20) document that "All access runs inside withTenant (RLS), so tenant boundaries are enforced by the database, not by these queries."

**Impact (if Option B chosen):** To enforce assigned-record-only visibility, add consultant-ID assignment filters to all internal query builders and authorization checks to all write actions. The existing `"admin"` role can be considered for an explicit bypass; no `"manager"` role exists today.

**Solution Required:** Add explicit assignment checks to internal actions/queries if Option B is chosen; define whether admin bypass applies.

---

## 8. Owner-Approved Decisions (Implementierung bindend)

### Decision 1: Record Visibility Model (✅ Approved)

**Approved:** Consultants see assigned records + unassigned team pool (claim allowed); managers/admins see all.

**Implementation:** Phase 0 backend work (query scopes, claim/reassignment rules, audit events).

### Decision 2: Role Model (✅ Approved)

**Approved:** Three internal roles — `consultant`, `manager`, `admin`. No separate operations role; operations use manager permissions.

**Implementation:** Phase 0 backend work (enum/session/auth migration); code currently only has consultant/admin.

### Decision 3: Manager Panel (✅ Approved as Planned Phase 1+)

**Approved:** Implement dedicated manager dashboard showing tenant-wide team pipeline, lead aging, consultant workload, task SLA, import quality, outbox approval queue, messaging outcomes, audit signals.

**Status:** Planned; Phase 1+ after role migration. Specify page/route proposal and acceptance criteria.

### Decision 4: Message Approval Workflow (✅ Approved)

**Approved:** Consultants draft; manager/admin approves. Creator cannot approve own draft (separation of duties). One approver sufficient; no two-person sign-off required. System-generated messages also require approval.

**Phase 0 Backend Changes:** Add `created_by`/`requested_by` to schema; implement atomic approval CAS.

**Blocker:** P1-1 (race condition fix) is mandatory before production.

### Decision 5: Styling (✅ Approved)

**Approved:** Incremental Tailwind adoption mapped to semantic CodeKessel design tokens. Preserve existing CSS; no big-bang rewrite. No gradients by default. Use official brand values once supplied.

**Phase 0:** Implementation spike — config/token mapping, coexistence, purge/content paths, regression strategy.

**Status:** Phase 0 decision spike → implementation architecture validation (updated from "decision spike").

### Decision 6: Accessible Primitives (✅ Approved)

**Approved:** Native semantic elements first; Radix primitives for complex dialog/popover/menu/select/tooltip where native behavior insufficient. Style with Tailwind/semantic tokens; no generic visual defaults.

**Phase 0:** Dependency/bundle check = implementation validation, not open product choice.

### Decision 7: Kanban View (✅ Approved as Optional, Phase 2+ After Validation)

**Approved:** Include optional secondary pipeline Kanban view. Table remains default. Initial Kanban read/triage oriented; cards open explicit validated transition actions. No direct drag-drop status mutation in first release. Drag-drop reconsidered only after safe server semantics, confirmation, audit, user validation.

**Status:** Planned Phase 2+ (behind user research validation).

### Decision 8: Outbox History (✅ Approved)

**Approved:** Add Pending and History views. History displays backend-supported dispatch/delivery states: sent, failed, delivered, read, rejected/cancelled. Distinguish provider acceptance from delivered/read. Filters/date range URL-driven. No invented bounced state.

**Phase 2:** UI implementation (after backend state verification).

### Decision 9: Dark Mode (✅ Approved Excluded)

**Approved:** Explicitly NOT required and excluded from redesign scope. Closed decision — not open.

### Decision 10: Mandatory Phase 0 Blockers (✅ Approved)

**Approved:** Atomic approval CAS + concurrency test before production. Add role/authorization + message-author schema changes as Phase 0 backend prerequisites. Deterministic pnpm CI.

---

## 9. Appendix: Verified Code References

| Artifact | File Path | Lines | Purpose |
|----------|-----------|-------|---------|
| Session model | `src/modules/auth/session.ts` | 14–20, 58 | Current role definition |
| Nav layout | `src/app/(internal)/layout.tsx` | 16–29 | Conditional nav |
| Pipeline page | `src/app/(internal)/pipeline/page.tsx` | 1–400+ | Lead list + KPIs |
| Task actions | `src/modules/tasks/actions.ts` | 138–200 | WhatsApp send |
| Outbox service | `src/modules/messaging/outbox.ts` | 21–69, 130–189 | Message queue + approval (race condition in approveAndDispatch lines 134–154, 180) |
| Outbox actions | `src/modules/outbox/actions.ts` | 21–69 | Approval/rejection |
| Participant actions-internal | `src/modules/participants/actions-internal.ts` | 49–56 | Internal server actions with tenant-scoped auth (no assigned-consultant checks) |
| Participant pipeline queries | `src/modules/participants/pipeline.ts` | 13–20 | Pipeline query layer (tenant-scoped, no per-consultant filters) |
| Audit log | `src/modules/audit/log.ts` | – | Activity recording |
| Import runs | `docs/REGISTER-IMPORT.md` | §1–§5 | Dedup, provenance |

---

**Status:** Ready for Implementation (Phase 0 Owner Decisions Applied)

