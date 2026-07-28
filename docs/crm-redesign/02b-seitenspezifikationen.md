# CRM-Redesign: Seitenspezifikationen

**Dokumentversion:** 2.1  
**Datum:** 2026-07-28  
**Status:** Planning Specification (Final Safety Cleanup)

---

## Inhaltsverzeichnis

1. [Pipeline (Operative Zentrale)](#pipeline)
2. [Tasks](#tasks)
3. [Outbox (Nachrichtenfreigabe)](#outbox)
4. [Appointments (Termine)](#appointments)
5. [Employers (Arbeitgeber)](#employers)
6. [Documents (Datensammlung)](#documents)
7. [Documents Detail (Antragsunterlagen)](#documents-detail)
8. [Applications (Anträge)](#applications)
9. [Reports (Berichte & Qualitätskennzahlen)](#reports)
10. [Leads: New](#leads-new)
11. [Leads: Import](#leads-import)
12. [Leads: Detail](#leads-detail)

---

## PIPELINE

**Route:** `/pipeline`  
**Quelle:** `src/app/(internal)/pipeline/page.tsx` (653 Zeilen)  
**Rollen:** Alle

### Current (Implementiert)

**Zweck:** Übersicht aller Leads im Vertriebstrichter mit Kennzahlen, Warnungen und Schnellfiltern.

**Implementierte Funktionen:**
- **Kennzahlen-Bereich** (Zeilen 343–418):
  - Operative KPIs: Gesamt, Erstkontakt offen, Erreicht (mit %), Interessiert, Qualifiziert+, Arbeitgeber offen, Nicht erreichbar, In Antrag
  - Kontaktierbarkeit: Telefon- und E-Mail-Abdeckung, Offen in Bearbeitung, Verloren (mit %)
  - Farb-Codierung (ok/warn/danger)
  - Hinweise bei < 80% Telefon oder < 50% E-Mail Abdeckung

- **Funnel & Konversion** (Zeilen 420–453):
  - Interaktive Balkendiagramme pro Status (anklickbar → Filter)
  - Konversionsraten: Erstkontakt → Erreicht → Qualifiziert → Antrag → Eingeschrieben
  - Prozentsätze und Absolutwerte

- **Engpässe & Handlungsbedarf** (Zeilen 455–467):
  - Statisch: Stale-New-Leads (> X Tage ohne Aktivität), Employer Pending, Falsche Nummern, Telefon fehlt, E-Mail fehlt
  - Alle Alerts anklickbar → Auto-Filter
  - Zähler-basiert (nur sichtbar wenn > 0)

- **Tabelle (PipelineTable Komponente)**:
  - Spalten: Name, Untertitel (Arbeitgeber · Ort), Status (mit Badge-Farbe), Berater, Quelle, Kontaktinfo (Phone/Email Icons), Erstellt, Aktualisiert, Nächste Aktion
  - Sortierung: Konfigurierbar (default: createdAt desc)
  - Pagination: 30 Items/Seite
  - Consultant-Inline-Reassignment (basierend auf Datatable-Feature, aber nicht explizit gezeigt)

- **Filter & Presets** (Zeilen 495–514):
  - Schnellfilter: "Alle", Presets (benutzerdefinierte Button-Filter aus `PIPELINE_PRESETS`)
  - Erweiterte Filter: Status (Multi), Berater, Quelle, Telefon/E-Mail (with/without), Zeitraum (createdFrom/createdUntil), Suchtext
  - URL-State: alle Parameter in Query String
  - Import-Status Meldungen (queued/conflicted/failed über Banner)

- **Alerts & Banners** (Zeilen 300–317):
  - Import-Ergebnis Banner (info/gate-Ton)
  - Zugriffsverweigerung für Nicht-Admins auf Register-Import

- **Aktionen (Header)** (Zeilen 284–297):
  - "Neuer Lead" → `/leads/new`
  - "Register-Import" → `/leads/import` (nur Admin)
  - Refresh Button
  - CSV Export (Query-String beibehalten, Page/PageSize entfernt)

- **Import-Verlauf** (Zeilen 609–652, `ImportRunHistory`):
  - Timeline mit Status-Badges (running/completed/failed)
  - Source, Starter, Start-Zeit, End-Zeit
  - Stat-Zusammenfassung (discovered/inserted/updated/skipped/conflicted/failed)
  - Error-Message bei fehlgeschlagenen Läufen

- **Visibility:** Consultant-Sichtbarkeitslimitierung (Zeile 17: `listConsultants`) — aktuell keine Berater-Filter-Restriktion implementiert; alle sehen alle.

### Target (Proposed)

**Operational-Center Enhancement — Table-First Approach (Kanban Planned Phase 2+):**

1. **View Strategy (Kanban Decision ✅ Approved Planned Phase 2+):**
   - **Current:** Server-paginated table (25–100 items/page), no client-side virtualization
   - **Approved Kanban Plan:** Optional card-based kanban view as product enhancement to explore only if:
     - User research demonstrates workflow value (drag-drop status changes, visual grouping)
     - Performance spike establishes feasibility with 500+ leads
     - Business rules support safe drag-drop transitions (see constraints below)
   - **Phase 2+ Timeline:** After product validation and user research completion
   - **Baseline (Phase 1):** Keep table as primary operational view; no Kanban in Phase 1

2. **Kanban Constraints (If Explored Phase 2+):**
   - **Critical:** Participant status transitions have gates, audit requirements, and routing side effects (auto-task generation, confirmations)
   - Do NOT support drag-drop status transitions directly
   - If kanban explored: Cards open existing explicit transition flow (`setLeadStatus` form with validation)
   - Drag-drop DISABLED until:
     - Transition-safe server semantics designed + tested
     - UX confirmation flow specified
     - Gate validation integrated (e.g., availability check blocks qualification)
   - Drag-drop may only reorder within same status column (non-blocking operation)

3. **Table Enhancements (Phase 1 Baseline):**
   - **Pagination & Filtering:**
     - Keep server-side pagination (current: 30 items/page, configurable 25/50/100)
     - Preserve URL-state for all filters (status, consultant, date range, search)
     - Pre-defined quick-filter buttons (Schnellfilter existing, kept as-is)
   - **Sorting:**
     - Maintain current sort options (column-based, URL-driven)
     - Persist sort preference in URL (no client storage required)
   - **Column Management:**
     - Optional: Column show/hide via menu (state in URL or session only)
     - No reordering; fixed logical order preferred for consistency
   - **Search & Filter Enhancement:**
     - Fuzzy participant search (name, phone, email)
     - Status multi-select (existing)
     - Consultant filter (existing)
     - Contact data filter (with/without phone/email, existing)
   - **Status Indicators:**
     - Text + color badges (no emoji-only signals)
     - Next-action labels (Nächste Aktion column, existing)

4. **Virtualization (Deferred, Performance-Gated):**
   - **Current Performance:** Export capped, page-size bounded
   - **Proposal:** Phase 0 measurement spike required before virtualization decision:
     - Establish production-like baseline (query time, render time, scroll performance)
     - Measure impact at 1000+ rows
     - Define user need (do users scroll 500+ items regularly?)
   - If spike justifies: React Window or equivalent (to be selected after measurement)
   - If not needed: Keep pagination as sufficient baseline

5. **Bulk Operations (If Proposed Later):**
   - **Bulk Assignment Exists:** Current inline reassignment supported
   - **Bulk Status Changes:** NOT proposed without:
     - Per-record gate validation (availability check, status-transition rules)
     - Preview before commit (show changes, affected records)
     - Audit trail (who, when, records affected)
     - Partial-failure semantics (some succeed, some blocked, clear reporting)
     - Explicit product owner approval
   - Example: "Mark 50 leads 'qualified' but 12 blocked (no availability)—proceed?"

6. **Saved Filters & View Persistence:**
   - **URL State:** Baseline, always supported (shareable, bookmarkable)
   - **Client-Only localStorage:** Optional UX enhancement (remember last filter session)
   - **User Profile Persistence:** Requires schema addition and product decision; not proposed here
   - **Quick-Filter Buttons:** Existing presets kept; no new named filter persistence without DB schema

### Acceptance Criteria & Tests

- [ ] URL filters persist across page reload (status, consultant, date range, search)
- [ ] Pagination: Select page 2, sort by createdAt, refresh page → state preserved
- [ ] Export CSV: Respects current filter and page size, all matching records included
- [ ] Status badges display text + color, no emoji-only signals
- [ ] KPI calculations accurate (Erreicht count, Contact rate %, Phone coverage %)
- [ ] Funnel chart clickable: Click status → filters to that status only
- [ ] Empty state: "Keine Leads im Filter" with clear reason when 0 results
- [ ] Mobile: Table becomes card-stack, no horizontal scroll
- [ ] Refresh button: Re-fetches data without changing filter state
- [ ] Performance: Establish Phase 0 baseline before optimization decisions (no fixed targets)

---

## TASKS

**Route:** `/tasks`  
**Quelle:** `src/app/(internal)/tasks/page.tsx` (193 Zeilen)  
**Rollen:** Alle (interne + externe Empfänger)

### Current (Implementiert)

**Zweck:** Offene Aufgaben (intern und extern) für Teilnehmer:innen, Arbeitgeber, Beratung auflisten + Link-Verwaltung.

**Implementierte Funktionen:**
- **Data List Layout** (Zeilen 103–189):
  - Grid-basiert: `gridTemplateColumns: "1fr auto auto auto auto auto"`
  - Spalten: Aufgabe (Titel + Owner + Fälligkeitsdatum), Channel-Badge, Status-Badge, Link-Status (ggf.), WhatsApp-Button (ggf.), Actions
  
- **Aufgaben-Display** (Zeilen 104–187):
  - Title: Task-Titel (z.B. "Einwilligungs-Link erzeugen")
  - Meta: Owner-Typ (Intern/Teilnehmer:in/Arbeitgeber) · Owner-Name · Fällig-Datum (deutsches Format, Europe/Berlin TZ)
  - Channel-Badge: Interne Aufgabe, E-Mail, WhatsApp, Aufgaben-Link
  - Status-Badge: Offen (warn) oder Eskaliert (danger)
  - Link-Status-Badge (bei external + applicable channels): "Link aktiv" oder "Link widerrufen" (danger)
  - WhatsApp-Button (bei WhatsApp/Magic-Link channels + Owner hat Telefon): Link senden (asynchron)

- **Aktionen nach Owner-Typ:**
  - **Internal Owner:** "Erledigt"-Button (Form submit, `completeTask` action)
  - **External Owner:** "Link erzeugen" + optional "Link widerrufen" (jeweils Forms)

- **Success Messages** (Zeilen 80–87):
  - Link revoked banner (conditional auf `?revoked=<count>`)
  - Info-Ton bei erfolgreicher Widerrufung
  - Gate-Ton bei "Kein aktiver Link zum Widerrufen"

- **Task Link Display** (Zeilen 89–98):
  - Wenn `?link=<url>` Query-Param vorhanden: Card mit generierten Link anzeigen
  - Readonly, Code-Element mit `wordBreak: break-all`

- **Empty State** (Zeile 100–101):
  - Generic "empty-state" Nachricht

### Target (Proposed)

1. **Task Priority & Urgency:**
   - **Current:** No priority shown
   - **Proposed:** Add priority indicator based on due-date proximity
     - Due soon (within configured threshold): High (red badge)
     - Due within week: Medium (yellow badge)
     - Due later: Low (gray badge)
   - Color-coded badges with text labels
   - Thresholds are configurable, not fixed time windows

2. **Task Grouping & Sorting:**
   - **By Owner-Type:** Internal → External Participants → Employers
   - **By Channel:** Email → WhatsApp → Magic-Link
   - **By Status:** Escalated first, then Open
   - **By Due-Date:** Closest first
   - Sortierung button-based (klickbar)

3. **Batch Link Actions:**
   - Multi-select checkboxes
   - "Generate links for selected external tasks"
   - "Revoke all links"
   - Bulk-operations asynchron, mit Progress-indicator

4. **Enhanced Filter:**
   - Filter by Owner-Type
   - Filter by Channel
   - Filter by Status
   - Filter by Owner Name (search)
   - Save filters

5. **Link Management Sidebar (optional):**
   - History of generated/revoked links (date, recipient, status)
   - Link expiry countdown
   - Copy-to-Clipboard button

6. **Responsive Adjustments:**
   - Mobile: Card-Stack, Action-Buttons vertical
   - Tablet: 4–5 Spalten (hide Owner Name, combine Channel+Status)

### Acceptance Criteria

- [ ] Priority badges show correctly (high/medium/low based on due date proximity)
- [ ] Grouping by Owner-Type works (Internal first)
- [ ] Bulk "Generate links" operation functions without UI freeze
- [ ] Link copy-to-clipboard works on all browsers
- [ ] Mobile: Actions stack vertically, no horizontal scroll
- [ ] Link history sidebar displays generated/revoked link metadata

---

## OUTBOX

**Route:** `/outbox`  
**Quelle:** `src/app/(internal)/outbox/page.tsx` (147 Zeilen)  
**Rollen:** Alle (Nachrichtenfreigabe erforderlich)

### Current (Implementiert)

**Zweck:** Ausstehende Nachrichten-Genehmigung (WhatsApp, E-Mail) vor Versand; History optional.

**Implementierte Funktionen:**
- **Pending Messages Only:**
  - Query: `listPendingMessages(tx)` (Zeile 40)
  - Filter: `outbound_messages.status = 'pending_approval'` (exact schema state)
  - Kein History/Archiv auf dieser Seite

- **Message Card Layout** (Zeilen 69–141):
  - `<article className="card">` pro Nachricht
  - Header: Empfänger-Name (oder Kind-Label fallback) + Badge für Channel
  - Empfänger-Info (Line 85): Kind, Name, Telefon (ggf.), E-Mail (ggf.)
  - Subject (optional, Line 93–97)
  - Body: `whiteSpace: pre-wrap`, max 500 chars placeholder
  - Actions:
    - **Approve:** Form mit `approveMessage` action
    - **Reject:** Form mit `rejectMessage` action + Reason-Input (max 500 chars)

- **Empty State** (Line 65–66):
  - Generic message

- **Banners:**
  - Success-Banner bei `?queued=1` (info-Ton)
  - Gate-Banner bei Fehler-Codes (`?result=failed|rejected|cancelled|not_found|not_pending|not_cancellable`)

- **Sender Number Display** (Lines 48–52):
  - Optional: zeige WhatsApp Sender-Nummer falls `env.WHATSAPP_SENDER_NUMBER` gesetzt

### Target (Proposed)

**Message Approval UI Enhancements (Decisions ✅ Approved):**

1. **Current Implementation Baseline:**
   - Pending messages only (approval queue)
   - Approve/Reject actions with reason capture
   - No delivery tracking or history on this page (planned Phase 2+ with backend verification)

2. **CRITICAL SAFETY REQUIREMENT (Data Integrity):**
   - **Double-Approval Race Condition:** Known issue where user clicks Approve twice rapidly, potentially creating duplicate sends
   - **Client-Side Defense-In-Depth:** UI disables button post-click, but this is NOT the fix
   - **Requires:** Atomic CAS (Compare-And-Swap) P1 backend fix before enabling production approval workflows
   - **Do not rely on client-side disabling alone for data integrity**

3. **Separation of Duties (✅ Approved):**
   - **Consultant creates draft:** Message created with `created_by = current_user`
   - **Creator cannot approve own draft:** Check `message.created_by !== current_user` before allowing approve button
   - **Manager/Admin approval:** Only `manager` or `admin` role can approve
   - **System-generated messages:** Also require manager/admin approval; `created_by = 'system'` or similar marker
   - **One approver sufficient:** Single approval completes dispatch; no two-person sign-off required
   - **Phase 0 Schema Work:** Add `created_by` field to `outbound_messages` table

4. **Optional History/Delivery View (Product Decision ✅ Approved Phase 2+):**
   - **Proposed:** Separate "History" tab showing sent messages (user-selected date range, conditional on product approval)
   - **Backend State Verification REQUIRED Before UI Claims:**
     - `outbound_message.status` enum: pending_approval, approved, sending, sent, delivered, failed, rejected, cancelled
     - `message_delivery.status` enum: sent, failed, delivered, read (via delivery-status.ts + WhatsApp webhooks)
     - Current implementation: `approveAndDispatch` transitions pending_approval → sending → sent/failed; `approved` state exists in schema but is currently bypassed (P2 consistency issue)
     - Distinguish dispatch-accepted (message queued to provider) from provider-confirmed-sent (provider ACK from external service)
     - History view may display exact supported delivery receipt states: sent, failed, delivered, read (not invented)
   - **Exact Supported States for History UI:**
     - "Pending Approval" (current, `outbound_message.status = 'pending_approval'`)
     - "Dispatch Queued" (current flow: pending_approval after approval action)
     - "Sent" (provider acknowledged transmission, `message_delivery.status = 'sent'`)
     - "Failed" (dispatch or delivery failed, `message_delivery.status = 'failed'` or `outbound_message.status = 'failed'`)
     - "Delivered" (provider-confirmed delivery, `message_delivery.status = 'delivered'`, backend supported)
     - "Read" (user-read receipt via webhook, `message_delivery.status = 'read'`, backend supported)
   - **Removed:** 'bounced' is not in backend enums; do not propose
   - **Phase 2 Timeline:** After backend state verification; no UI changes Phase 1

5. **Consultant Visibility (Owner Decision ✅ Approved as Part of Visibility Model):**
   - **Approved:** Consultants see pending messages for:
     - Records assigned to them + team pool (per record visibility model decision)
   - **Manager/Admin:** See all pending messages (tenant-wide)
   - **Downstream UI Impact:**
     - Consultant: sees only assigned/pool record messages; approver list filtered
     - Manager/Admin: sees all tenant messages; approver list unrestricted
   - **Backend Filter:** `listPendingMessages()` respects consultant context (queries using record visibility rules)

6. **Enhanced Current View (Approval Queue):**
   - Message preview (full body visibility, expandable if long)
   - Recipient context: Last contact date, lead status, current task count
   - Resend option for rejected messages (if applicable)
   - Scheduled send time (when will this message go out post-approval?)

7. **Message History (Phase 2+ If Approved After Decision):**
   - Tab: "Delivered Messages" (user-selectable date range, no fixed retention window)
   - Read-only display of sent/failed messages
   - Per-message: Recipient, channel, sent timestamp, status
   - Error details for failed messages (e.g., invalid phone number)
   - No bulk resend without explicit owner approval

8. **Delivery Status Labels (Supported States Only):**
   - Text labels (no emoji-only signals):
     - "Awaiting approval" (current state)
     - "Sent" (approved, backend confirmed transmission)
     - "Rejected" (user rejected with reason)
     - "Failed – [reason]" (delivery error)
   - Mark future states clearly: "Read receipts (future, backend pending)"

### Acceptance Criteria

- [ ] Approve-button: Message queued, approval logged, creator cannot approve own message
- [ ] Reject with reason: Message not sent, reason stored
- [ ] Pending queue: Only messages in pending_approval state shown
- [ ] Text labels: Status shown as text, not emoji-only
- [ ] Mobile: Card-stack layout, action buttons stacked vertically
- [ ] [Phase 2+ if history approved] History displays sent/failed messages (product decision)
- [ ] [Approved] Consultant visibility: Backend filter enforced per record visibility model
- [ ] Separation of duties: UI disables approve button if current_user == message.created_by
- [ ] CAS P1 fix deployed before production approval workflows enabled

---

## APPOINTMENTS

**Route:** `/appointments`  
**Quelle:** `src/app/(internal)/appointments/page.tsx` (107 Zeilen)  
**Rollen:** Alle

### Current (Implementiert)

**Zweck:** Alle Termine (Follow-up, Beratung, Eignungstest) chronologisch auflisten + Status-Verwaltung.

**Implementierte Funktionen:**
- **Query** (Zeilen 31–44):
  - JOIN Appointments + Participants + Users
  - ORDER BY `appointments.scheduledAt DESC`
  - No filter for consultant (shows all tenant appointments)

- **Data Row Layout** (Zeilen 62–100):
  - Grid: `gridTemplateColumns: "1fr auto auto auto"`
  - Columns:
    - Participant Link (First + Last Name) · Type-Label
    - DateTime (formatted via `fmtDateTime`)
    - Consultant Name (ggf.)
    - Notes (ggf.)
  - Status Badge (colored based on type + status)
  - Conditional buttons:
    - If `scheduled` or `reminder_sent`: "Stattgefunden" (completed), "No-Show" (danger)
    - Else: empty span (placeholder)

- **Empty State** (Zeilen 56–59):
  - Generic message + hint about scheduling on lead-detail page

### Target (Proposed)

**Phase 1 Baseline: Improve Current List View**

1. **Current List Enhancements:**
   - Add type-specific icons (Folgetermin, Beratung, Eignungstest)
   - Clearer status progression (scheduled → reminder_sent → completed/no_show/cancelled)
   - Inline status quick-change buttons (existing, keep as-is)

2. **Optional Calendar View (Product Decision Pending):**
   - **Proposed:** Week view (current week + next 2 weeks) behind separate product decision
   - Requires: Workflow validation, authorization decision (who can reschedule?), UI confirmation design
   - **Drag-to-reschedule:** NOT supported without:
     - Validated server action (timezone/conflict checking)
     - Confirmation dialog (automatic reminders, resource conflicts)
     - Audit trail (who moved the appointment, when, why)
     - Partial-failure semantics (reschedule succeeds but reminder send fails)
     - Explicit product owner + workflow approval
   - If calendar explored: Reorder-only within day (non-blocking operation), explicit update buttons for date/time changes

3. **Optional Consultant Filter (Product Decision Pending):**
   - **Proposed:** "Alle Berater" vs. "Meine Termine" dropdown (authorization decision required)
   - For non-admin: default behavior to be decided (show all tenant or only own?)
   - Requires: Role-based access policy + backend filter implementation

4. **Optional Recurring Appointments (Product Decision Pending):**
   - Requires: Pattern definition UX, series-vs-instance edit distinction, notification strategy
   - Blocking: Relationship to Eignungstest invite pattern (duplicates existing concept?)

3. **Optional Alerts (Product Decision Pending):**
   - "Reminders today" alerts: User-configured time window
   - "No-Shows expected" for past appointments without status
   - Note: Appointment reminder configuration supports routing rules (e.g., 24h, 72h examples); specific timings are business/routing decisions
   - Requires: Escalation workflow + team routing decision

### Acceptance Criteria

- [ ] Current list displays all appointments (test_phase, ordered by scheduledAt DESC)
- [ ] Status buttons ("Stattgefunden", "No-Show") correctly update appointment status
- [ ] Mobile: Compact card layout, action buttons stacked
- [ ] [If calendar view approved] Week view renders without data loss
- [ ] [If drag-to-reschedule approved] Requires CAS backend + confirmation UX
- [ ] [If consultant filter approved] Authorization decision documented + backend filter
- [ ] [If recurring approved] Series/instance distinction specified + conflict resolution

---

## EMPLOYERS

**Route:** `/employers`  
**Quelle:** `src/app/(internal)/employers/page.tsx` (216 Zeilen)  
**Rollen:** Alle (Setup-Link erzeugen)

### Current (Implementiert)

**Zweck:** Arbeitgeber-Onboarding-Status + BA-Antragsdaten-Verwaltung.

**Implementierte Funktionen:**
- **Query** (Zeilen 34–36):
  - SELECT * FROM employers, ordered by companyName ASC
  - No status filtering

- **Status Badges** (Zeilen 14–23):
  - new, invited, setup_in_progress, betriebsnummer_missing, ags_unclear, time_model_pending, confirmed, declined
  - Color-coded: ok/warn/danger

- **Data Row Layout** (Zeilen 78–100):
  - Grid: `gridTemplateColumns: "1fr auto auto"`
  - Columns:
    - Company Name
    - City, Industry, Betriebsnummer/Status, Contact Name
    - Status Badge
    - Setup-Link-Button (wenn Status != confirmed)

- **Setup-Link Output** (Zeilen 63–71):
  - If `?link=<url>` query param: Show code-box mit URL

- **BA-Antragsdaten Form** (Zeilen 114–214, `EmployerBaForm`):
  - Collapsible `<details>` section per employer
  - Fields: Rechtsform, Betriebsvereinbarung, IBAN + BIC, Staffing-Bands, Salary-Components
  - Submit: `updateEmployerBaData` action (validated on submit)

- **Messages** (Zeilen 49–61):
  - `?badata=saved` → info-banner
  - `?badata=iban|bic` → gate-banner with specific error

### Target (Proposed)

1. **Setup Wizard Progress (Enhanced Display):**
   - Current: Just a link
   - Proposed: Show visual progress indicator
     - Step 1/4: Betriebsnummer (✓ or pending)
     - Step 2/4: AG-S Klarheit (pending or ✓)
     - Visual progress bar
   - Long-stuck setup (7+ days) generates internal follow-up task

2. **Status Filtering & Grouping (Product Decision Pending):**
   - Tabs: All, Active (confirmed/setup_in_progress), Onboarding (new/invited/pending), Issues (declining/missing-data)
   - Requires: Authorization + workflow validation

3. **BA-Data Form Improvements (Product Decision Pending):**
   - **Autosave:** NOT proposed without:
     - Explicit UI indicator ("Saving..." + "Saved" state)
     - Debounce strategy (2s idle minimum)
     - Error handling (failed saves show persistent error, never silently discard)
     - Audit trail (who edited when, revision history)
     - Explicit product owner approval
   - Move from collapsible to modal/sidebar (UX improvement requires design review)

4. **Bulk Operations (Product Decision Pending):**
   - Bulk "Generate Setup Links" (non-blocking, can be proposed)
   - Bulk "Mark as Confirmed" requires explicit product review

5. **Integration Status Dashboard:**
   - Show which employers have active participants, pending applications, completed participants
   - Requires: Business logic definition

### Acceptance Criteria

- [ ] Setup wizard progress bar shows correct step count
- [ ] BA-Data form submits, shows confirmation message
- [ ] IBAN validation: Invalid checksum → error message, not saved
- [ ] Filter tabs: "Onboarding" tab shows only specified statuses
- [ ] [If autosave approved] "Saving..." indicator appears, confirmation on success
- [ ] Mobile: Card layout with compact forms

---

## DOCUMENTS

**Route:** `/documents`  
**Quelle:** `src/app/(internal)/documents/page.tsx` (62 Zeilen)  
**Rollen:** Alle

### Current (Implementiert)

**Zweck:** Master-Index aller Teilnehmer mit Dokument-Zähler + Link zu Detail-Checkliste.

**Implementierte Funktionen:**
- **Query** (Zeilen 14–27):
  - LEFT JOIN participants + documents
  - GROUP BY participant.id, Count documents
  - ORDER BY lastName ASC

- **Data Row Layout** (Zeilen 39–57):
  - Grid: 1fr auto auto
  - Columns: Name (Link), Status, Document Count, "Checkliste öffnen" Button

### Target (Proposed)

1. **Search & Filter:**
   - Teilnehmer-Name (fuzzy search)
   - Filter by Status (new, qualified, test_phase, documents_phase, etc.)
   - Filter by Document-Count (0, 1-3, 4+)
   - Filter by last-modified date (qualitative windows: this week, this month, older)

2. **Quick Stats:**
   - Count: "X participants ready for document collection"
   - Count: "Y docs pending signature"
   - Count: "Z applications in submission"

3. **Bulk Actions (Gated):**
   - Bulk "Send upload links" (non-blocking, can be proposed)
   - Bulk "Generate application packages" (requires readiness gating per record)

4. **Sort Options:**
   - By Name (current), Last Modified, Document Status, Participant Status

5. **Table Enhanced:**
   - Add "Last Modified" column, "Document Status" badge, "Participant Status" badge

### Acceptance Criteria

- [ ] Search finds participants by partial name match
- [ ] Filter by status works correctly
- [ ] Bulk "Generate packages" completes without UI freeze
- [ ] Sort by last-modified: newest first
- [ ] Mobile: Card layout, search in header

---

## DOCUMENTS DETAIL (Antragsunterlagen)

**Route:** `/documents/[participantId]`  
**Quelle:** `src/app/(internal)/documents/[participantId]/page.tsx` (368 Zeilen)  
**Rollen:** Alle

### Current (Implementiert)

**Zweck:** Zentrale Datensammlung (Checkliste) + Formulare + Signatur-Verwaltung für einen Teilnehmer.

**Implementierte Funktionen:**

**Left Column (Lines 80–273):**
- **Checkliste** (Lines 81–96): Checklist items with states (ok/warn/missing)
- **eService-Upload-Set** (Lines 98–139): Required + optional documents, signature requirements
- **Einzelantrag** (Lines 141–163): Form generation buttons
- **Teilnehmerformulare** (Lines 165–189): Pre-filled BA forms
- **Sammelantrag** (Lines 191–217): Company application forms
- **Interne Dokumente** (Lines 219–241): Internal templates
- **Antrag Section** (Lines 243–272): Application status/creation

**Right Column (Lines 276–363):**
- **Dokumente-Liste**: Document cards with status, signatures, actions
- **Empty State** (Line 279–281): "Noch keine Dokumente erstellt."

**Logic:**
- Submission readiness (computeReadiness): Identifies blockers
- Upload-set evaluation: Determines required vs. optional documents + signature requirements
- QES handling: Marks if QES required but provider not connected
- Canvas signature: Only offered if form allows + not already signed

### Target (Proposed)

1. **Process Timeline (Enhanced Display):**
   - Visual pipeline: Data Collection → PDF Generation → Signature → Submission → Delivery
   - Show current step + completion % (data-driven from actual progress)
   - Estimated time to completion (based on historical data)

2. **Signature Management Improvements (Gated):**
   - Bulk "Request all signatures" (non-blocking, can be proposed)
   - Signature deadline tracking (user-configurable window)
   - Resend reminders (configurable inactivity threshold; common routing examples: 24h, 72h; requires product decision)
   - Audit log (who signed when, IP, device)

3. **Document Versioning (Product Decision Pending):**
   - Store multiple versions if regenerated
   - Show version history (Created v1.0 → Regenerated v1.1)
   - Revert option (requires business logic decision: what gets reverted?)

4. **QES/Canvas Integration Status:**
   - Status indicator: "Connected (last tested 14:20)" or "Not configured"
   - Health check: "Last test at 14:20 — success" or failure status

5. **Document Validation & Readiness Gating:**
   - Show exact blockers (e.g., "Missing: SV-Nummer, Bankdaten")
   - Offer quick-fix links
   - Auto-check on data updates (requires debounce strategy)

6. **Bulk Document Generation (Gated):**
   - Select multiple participants, generate document type for all
   - Progress indicator + notification
   - Requires: per-record readiness validation

### Acceptance Criteria

- [ ] Process timeline shows correct current step + completion %
- [ ] Bulk signature requests completes without UI freeze
- [ ] Document status displays correctly (data_missing, prefilled, reviewed, approved, sent, submitted, partially_signed, signed)
- [ ] QES status: "Connected" or "Not configured" label displays correctly
- [ ] Blocker gating: Application submit button disabled if blockers exist
- [ ] Mobile: Timeline collapses, single-column document list
- [ ] [If autosave approved] Requires UI indicator + audit trail

---

## APPLICATIONS

**Route:** `/applications`  
**Quelle:** `src/app/(internal)/applications/page.tsx` (233 Zeilen)  
**Rollen:** Alle

### Current (Implementiert)

**Zweck:** Antragsverwaltung über gesamten Lebenszyklus.

**Implementierte Funktionen:**
- **Status Workflow:** in_preparation → complete → sent_to_employer → submitted → response_pending → approved | rejected | correction_required
- **Readiness Gating:** Blockers resolved for in_preparation status, button disabled if blocked
- **Conditional Actions per Status:** Status-dependent buttons for workflow progression

### Target (Proposed)

1. **Application Status Dashboard (New):**
   - Summary cards: "In Preparation" (with % to completion), "Pending Employer", "Pending BA", "Approved" (YTD), "Rejected"
   - Requires: Business logic for completion %

2. **Timeline per Application (New):**
   - Status transitions (timestamps + who changed it)
   - Approval SLA (business rule definition required)
   - Correction cycles (if correction_required → complete)

3. **Bulk Operations (If Proposed After Product Review):**
   - **Bulk "Send Reminders":** Safe non-blocking operation, can be proposed
   - **Bulk Status Changes ("Mark as Approved"):** NOT proposed without:
     - Per-record gate validation (check if application ready for each)
     - Preview before commit
     - Audit trail (who, when, which records)
     - Partial-failure handling (some blocked, some success—clear reporting)
     - Explicit product owner approval + UX confirmation design
   - Example: "Mark 30 'response_pending' as approved, but 5 blocked (missing docs)—proceed?"

4. **Advanced Filtering (Product Decision Pending):**
   - Filter by Participant Status, Submission Date Range, Response Pending Duration (>X days business rule), Type

5. **Export & Reporting:**
   - Export to Excel (with status timeline)
   - "Pending Approvals" report for BA stakeholders
   - "Time to Approval" metric (for reports page)

### Acceptance Criteria

- [ ] Status dashboard counters accurate
- [ ] Timeline shows all status transitions with timestamps
- [ ] Bulk "Send Reminders" completes without UI freeze
- [ ] Filter by response_pending > N days (business rule)
- [ ] Export to Excel includes timeline
- [ ] Mobile: Card layout, timeline collapsed by default
- [ ] [If bulk status change approved] Per-record validation + preview + audit

---

## REPORTS

**Route:** `/reports`  
**Quelle:** `src/app/(internal)/reports/page.tsx` (281 Zeilen)  
**Rollen:** Alle

### Current (Implementiert)

**Zweck:** Kennzahlen + Qualitätsmetriken + Funnel-Analyse für Prozess-Schwachstellen.

**Implementierte Funktionen:**
- **Filter Form:** Date range, Consultant filter, Submit
- **Metric Groups:** Leads, Appointments, Aptitude Tests, Employers, Applications
- **Funnel Section:** Horizontal bar chart showing stage counts + drop-off
- **KPI Card Component:** Label, value, suffix, hint, tone

### Target (Proposed)

1. **Cohort Analysis (New):**
   - Compare "Leads created in Jan" vs. "Feb" cohorts
   - Side-by-side conversion rates
   - Identify seasonal trends (data-driven)

2. **Consultant Benchmarking (New, Product Decision Pending):**
   - Compare individual consultant metrics
   - Identify top/bottom performers
   - Show peer-avg for context (e.g., "Your no-show rate: 8% vs. avg 12%")
   - Requires: Privacy + authorization decision (who sees whose metrics?)

3. **Anomaly Detection (Optional, Product Decision Pending):**
   - Alert if metric spike (statistical threshold to be defined)
   - Flag underperforming days/weeks

4. **Export & Scheduling (Product Decision Pending):**
   - Email report to stakeholders (daily/weekly/monthly frequency)
   - Export to PDF/Excel

5. **Historical Trending (New):**
   - Line chart over 3-month period (vs. current period)
   - Trend direction (improving/declining)

6. **Goal Setting & Tracking (Product Decision Pending):**
   - Set targets (e.g., "Contact rate target: 75%")
   - Progress bar (current vs. target)
   - Off-track alert (< 70% of target)

### Acceptance Criteria

- [ ] Filter by date range loads metrics correctly
- [ ] Filter by consultant shows only that consultant's metrics
- [ ] Funnel chart clickable: Click stage → drill down to lead list
- [ ] Cohort comparison identifies differences
- [ ] Export to Excel/PDF completes without error
- [ ] Mobile: Cards stack, Funnel chart becomes vertical

---

## LEADS: NEW

**Route:** `/leads/new`  
**Quelle:** `src/app/(internal)/leads/new/page.tsx` (67 Zeilen)  
**Rollen:** Alle

### Current (Implementiert)

**Zweck:** Quick-entry form zum Anlegen neuer Leads (manuell).

**Implementierte Funktionen:**
- **Form Fields:** First Name (required), Last Name (required), Phone (optional), Email (optional), City (optional), Source (optional)
- **Validation:** Server-side check of first + last name + email format
- **Auto-Assignment:** Lead assigned to current user, starts in "new" status

### Target (Proposed)

1. **Enhanced Validation:**
   - Real-time validation feedback (email format, phone format)
   - Duplicate detection (name + phone / email already exists? → Warn but allow)
   - Phone number formatting (auto-format to E.164 or German standard)

2. **Quick Actions After Creation (Product Decision Pending):**
   - Option: "Create and schedule appointment"
   - Option: "Create and add to campaign"
   - Option: "Create and go to detail page" (for immediate data entry)
   - Requires: Workflow + authorization decision

3. **Bulk Lead Import (UI, Product Decision Pending):**
   - CSV paste or file upload
   - Column mapping (Name, Phone, Email, Source)
   - Preview rows before submit
   - Requires: Validation strategy, duplicate handling

4. **Lead Source Autocomplete:**
   - Dropdown with recent sources (Meta Ads, Website, Referral, etc.)
   - Allow custom source entry

5. **Employee Context (Admin-Only):**
   - Show current user + option to assign to different consultant
   - Confirm: "Lead will be assigned to [name]"

### Acceptance Criteria

- [ ] Submit form: New lead created, redirected to detail page
- [ ] Email validation: Invalid email → error, not created
- [ ] Phone formatting: Auto-formatted correctly
- [ ] Duplicate warn: Name + phone exists → warning, creation allowed
- [ ] [If bulk CSV approved] Upload, validate, preview, create without UI freeze
- [ ] Mobile: Form spans full width, readable

---

## LEADS: IMPORT

**Route:** `/leads/import`  
**Quelle:** `src/app/(internal)/leads/import/page.tsx` (347 Zeilen)  
**Rollen:** Admin only

### Current (Implementiert)

**Zweck:** Register-Import: Zahlungsschwache Unternehmen aus Handelsregister finden + als Leads importieren.

**Implementierte Funktionen:**
- **Search Criteria Form:** Employees (min/max), Federal State, Legal Form (checkboxes), Industry Code (checkboxes)
- **Provider Info:** Badge showing "OpenRegister live" or "Demo (Mock)"
- **Results Section:** Results heading, per-company cards, single-import buttons, pagination
- **Access Control:** Admin-only gate, non-admin redirects to `/pipeline?forbidden=1`

### Target (Proposed)

1. **Search History & Saved Searches:**
   - Auto-save last search (localStorage client-side only)
   - Quick-access dropdown: "Recent searches"
   - Starred searches (requires DB schema decision)

2. **Batch Management (Gated):**
   - Select multiple companies across pages (remember selection)
   - "Import all X selected" action
   - Undo bulk import (requires transaction + audit trail)

3. **Conflict Resolution:**
   - Show tooltip if company already imported (Imported by [user] on [date])
   - Option to re-import (create duplicate lead or link to existing? → product decision)

4. **Advanced Filtering (On Results, Product Decision Pending):**
   - Filter by: Profit range, Employee count, Legal form, Industry
   - Sort by: Profit (desc), Employees (desc), Company name

5. **Preview & Metadata:**
   - Expand company card to show full record (financials, history)
   - Show matching leads (if duplicates by name/city)

6. **Import Progress & Notifications (Product Decision Pending):**
   - Bulk importing 100 companies: show progress bar
   - Completion notification (email or in-app)
   - Report: "Successfully imported 98, skipped 2 (duplicates)"

### Acceptance Criteria

- [ ] Search: Filter by employees/legal form/industry returns results
- [ ] Pagination: Navigate between pages, load correct data
- [ ] Single import: Company → Lead created, marked "already imported" on resubmit
- [ ] Bulk import: Multiple companies created without UI freeze
- [ ] Conflict: Already imported company shows tooltip
- [ ] Mobile: Form accessible, results as scrollable card list
- [ ] Access control: Non-admin redirected to pipeline

---

## LEADS: DETAIL

**Route:** `/leads/[id]`  
**Quelle:** `src/app/(internal)/leads/[id]/page.tsx` (774 Zeilen)  
**Rollen:** Alle

### Current (Implementiert)

**Zweck:** Zentrale Lead-Verwaltung: Status-Transitions, Verfügbarkeits-Check, Eligibility, BA-Daten, Appointments, Tests, Notes, Activity Log.

**Implementierte Komponenten:**
- **Header:** Breadcrumb, Name + Status badge, City, Phone, Email, Source
- **Alert Banners:** Availability gate, Status transition, Undo, Consent/Upload links, IBAN/BIC/SV errors
- **Two-Column Layout:**
  - LEFT: Call Script, Eligibility, BA-Antragsdaten, Consents, Upload, Contact Notes
  - RIGHT: Availability Gate, Status Change, Appointments, Aptitude Test, Activity Log

### Target (Proposed)

1. **Streamlined Layout (Responsive):**
   - Desktop: Two-column (current)
   - Tablet: Single-column, sections collapsible
   - Mobile: Accordion for each section

2. **Quick Actions Sidebar (Gated):**
   - Pinned actions: Status change, Schedule appointment, Generate links
   - **Keyboard shortcuts:** Ctrl/Cmd+Z on lead detail only (existing, keep)

3. **Inline Status Changes (NOT Proposed Without Business Semantics):**
   - **Current:** Explicit `setLeadStatus` form with dropdown + submit (correct approach)
   - **Proposed inline changes:** Disabled unless:
     - Business rules clearly specify safe inline transitions (no gates)
     - Audit trail logged per transition
     - Confirmation dialog for destructive changes
     - Explicit product owner approval
   - **Status transitions are gated:** Availability check blocks qualification, eligible transitions differ per status

4. **Related Leads Widget (New):**
   - Show other leads with same employer, measure, similar status+timeline
   - Requires: Query optimization + authorization decision

5. **Conflict Detection (New, Gated):**
   - If lead data conflicts (different employer referenced in two places):
     - Highlight conflicting sections
     - Offer resolution (keep/overwrite)
   - Requires: Detection logic + merge strategy

6. **Form Auto-Save (NOT Proposed Without Safety Semantics):**
   - **Current:** Manual submit only (correct, safe approach)
   - **Proposed autosave:** Disabled unless:
     - UI indicator visible ("Saving..." + "Saved" state)
     - Debounce strategy (2s minimum idle, not per keystroke)
     - Error handling (failed saves show persistent error, never silently discard)
     - Audit trail (who edited when, revision history)
     - Explicit product owner approval + per-field conflict resolution UX
   - **Current BA-Antragsdaten form is correct:** Manual submit, validation on server

7. **Document Readiness Dashboard (New):**
   - Show which documents need data
   - "Complete this section to unlock document generation"
   - Link to missing field

8. **Status Transition Visualization (New):**
   - Show allowed next statuses (highlight in dropdown)
   - Show blocked transitions (grayed out + tooltip reason)
   - Show consequence (e.g., "Status=Lost" → closes all open tasks")

### Acceptance Criteria

- [ ] Status change: Select new status, submit, activity log entry created
- [ ] Availability gate: "Nein" selected → task generated, qualification blocked
- [ ] BA-Data save: All fields (SV, IBAN, salary, training times, qual, funding), no validation errors
- [ ] Appointment scheduling: Type + datetime, submit, appears in timeline
- [ ] Test outcome: Mark "Bestanden", status → test_phase progresses
- [ ] Notes: Add note, appears in timeline with author/timestamp
- [ ] Undo (Ctrl+Z): Revert last status change, tasks cancelled
- [ ] Related leads: Show same employer, quick-compare
- [ ] Mobile: Accordion sections, sticky quick-actions, full-width forms
- [ ] Validation: Invalid IBAN → error message, not saved
- [ ] [If inline status approved] Business gates enforced, audit trail logged
- [ ] [If autosave approved] UI indicator + error handling + audit trail

---

## Cross-Cutting Concerns

### Keyboard & Focus Behavior

| Control | Behavior | Accessibility |
|---------|----------|----------------|
| **Buttons** | `Enter` to activate; visible focus ring | `aria-label` for icons (no emoji-only descriptions) |
| **Forms** | `Tab` navigation in logical order | `<label>` linked to inputs; `aria-required` for mandatories |
| **Modals** | `Esc` to close; focus trap | `aria-modal="true"`, `role="dialog"` |
| **Dropdowns** | `ArrowUp/Down` to navigate; `Enter` to select | `aria-expanded`, `role="listbox"` |
| **Shortcuts** | Ctrl/Cmd+Z on lead detail only | Show hints in help panel, not assumed |
| **Search** | Debounced onChange | Input accessible, no auto-submission |

### Accessibility Semantics

- **Color not only signal:** Badges have text + color (e.g., "Offen" not just yellow)
- **Alt text:** Icons have `aria-label` (no emoji-only descriptions)
- **Headings:** Proper hierarchy (h1 > h2 > h3), no skipping levels
- **Lists:** Use `<ul>`, `<ol>`, `<li>` for lists (not just divs)
- **Links vs. Buttons:** Links navigate; buttons perform actions
- **Form validation:** Error messages linked to inputs (`aria-invalid`, `aria-describedby`)
- **ARIA landmarks:** `<main>`, `<nav>`, `<header>`, `<footer>`
- **Language:** `lang="de"` on `<html>` tag

### Performance (Measured, Not Fixed)

| Operation | Baseline Requirement | Measurement Method |
|-----------|---------------------|-------------------|
| Pipeline page initial load | Responsive (user perceives within acceptable window) | Lighthouse, Core Web Vitals on production-like dataset, Phase 0 baseline |
| Filter application (URL change) | Responsive (user perceives quickly) | Page transition time from filter button click to render, Phase 0 baseline |
| Table sort | Responsive (instant) | URL-driven re-fetch; measure backend query + render time, Phase 0 baseline |
| Pagination navigation | Responsive | Page change time, establish actual baseline Phase 0 before optimization |
| Bulk action (N items) | Complete without UI freeze | Backend batch API, progress indicator during execution |
| CSV export (N rows) | Completes without memory spike | Streaming response; measure against median connection speed |

**Critical:** All performance decisions gated on Phase 0 baseline measurement. No fixed < 500ms / < 1s / 60fps targets; establish production-like baseline first, agree percentile budgets with stakeholders, measure regressions vs. baseline.

### Business Rules & Time Windows (Not Performance Targets)

- **7 days stale-lead cutoff:** Current implemented business rule for alert (not performance target)
- **2s autosave debounce:** UX minimum (if autosave approved; not performance target)
- **Appointment reminder configuration:** Backend supports routing rules with configurable thresholds (e.g., 24h, 72h are examples, not universal); specific timings are business/routing decisions, not SLAs
- **Signature reminder configuration:** Backend routing supports configurable inactivity thresholds (e.g., 24h, 72h are examples); specific timings are user/business decisions, not fixed
- **Message history retention:** User-selectable date range, no fixed retention window prescribed
- **Note:** Removed references to invented universal windows (14-day BA SLA, 30-day retention, 24h WhatsApp reminder as product rule) without source implementation backing

### Security & Validation

- **Server-side validation:** All forms must validate on backend (never trust client-side only)
- **CSRF tokens:** All mutating actions require valid session token (Next.js built-in)
- **SQL injection:** Use parameterized queries (Drizzle ORM enforced)
- **XSS prevention:** Sanitize user input (React auto-escapes JSX)
- **Rate limiting:** Bulk actions rate-limited (business rule)
- **Audit logging:** All status changes, deletions, bulk actions logged with user + timestamp
- **Role-based access:** All routes check `session.role` (Consultant, Admin, Outbox_Approver, etc.)
- **CAS P1 Fix Requirement:** Outbox double-approval race condition requires atomic backend fix before production

---

## Summary Table: Page Specifications

| Page | Route | Current Size | Type | Primary Action | Target Changes |
|------|-------|--------------|------|---------------|----|
| Pipeline | `/pipeline` | 653 L | Dashboard + Table | View leads, apply filters | Table baseline, Kanban (decision pending), bulk ops (gated), virtualization (perf-gated) |
| Tasks | `/tasks` | 193 L | List | Complete/revoke tasks | Priority badges, grouping, bulk operations |
| Outbox | `/outbox` | 147 L | Approval Queue | Approve/reject messages | History tab (decision pending), delivery status (schema review), CAS P1 fix (required) |
| Appointments | `/appointments` | 107 L | List | Mark complete/no-show | List enhancements, calendar (decision pending), drag-reschedule (gated), consultant filter (gated) |
| Employers | `/employers` | 216 L | List + Forms | Setup links, BA data | Progress indicator, status tabs (decision pending), autosave (gated), bulk ops (gated) |
| Documents | `/documents` | 62 L | Index | Browse participant docs | Search, filter, bulk generation |
| Documents Detail | `/documents/[participantId]` | 368 L | Multi-section | Generate docs, request sig | Process timeline, bulk signature, versioning (decision pending), autosave (gated) |
| Applications | `/applications` | 233 L | List + Actions | Status transitions | Dashboard, timeline, bulk ops (gated) |
| Reports | `/reports` | 281 L | Metrics Dashboard | View KPIs | Cohort analysis (data-driven), benchmarking (privacy decision), export (gated) |
| Leads: New | `/leads/new` | 67 L | Form | Create lead | Validation, duplicate detection, bulk CSV (gated) |
| Leads: Import | `/leads/import` | 347 L | Search + Results | Import companies | Search history, batch mgmt, conflict resolution |
| Leads: Detail | `/leads/[id]` | 774 L | Hub | Manage lead lifecycle | Responsive accordion, related leads, status visualization, inline changes (gated), autosave (gated) |

---

## Document Metadata

- **File:** `/Users/zeberemer/Desktop/codekessel/sales-automation/docs/crm-redesign/02b-seitenspezifikationen.md`
- **Last Updated:** 2026-07-28 (Final Safety Cleanup, Version 2.1)
- **Verified Pages:** 12/12 from `src/app/(internal)/**/page.tsx`
- **Status:** Planning Specification (Current implementation + Proposed enhancements, all decisions gated)
- **Critical Notes:**
  - All proposed features requiring autosave, inline status changes, drag-drop, or bulk status changes now explicitly gated on product owner approval + business-safe server semantics design
  - Outbox double-approval CAS P1 backend fix is prerequisite for production approval workflows (UI disabling is defense-in-depth only)
  - ALL fixed performance targets (<500ms, <1s, 60fps, page load limits) removed; Phase 0 baseline measurement required before optimization decisions
  - Appointments calendar/drag/recurring/consultant-filter all behind separate product decisions
  - Outbox delivery states limited to backend-verified enum; unverified states marked Future
  - E2E testing: Playwright only (existing dependency); Cypress requires owner approval
  - Route parameter: `/documents/[participantId]` (verified exact from source)
  - No emoji-only status indicators; text labels + color required throughout
  - All bulk status changes require per-record gate validation + preview + audit trail design before implementation
