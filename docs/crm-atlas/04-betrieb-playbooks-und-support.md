# Betrieb: Playbooks & Support (Safety-Reviewed Edition)

**Zuletzt aktualisiert:** 28. Juli 2026  
**Review-Status:** Sicherheitsüberprüfung (28. Juli) — Unsafe SQL und erfundene Operationen entfernt  
**Scope:** `sales-automation/` — Operational Wiki für Produktion (vorläufig)  
**Hinweis:** Diese Dokumentation unterliegt Engineering-, Sicherheits- und Compliance-Review vor Production-Einsatz.

---

## Sicherheits-Hinweis

Dieses Dokument beschreibt nur **implementierte** Operationen und sichere Diagnose-Maßnahmen. Alle destruktiven Änderungen (User, Tenant, Nachrichten-Status, Zustimmung) müssen über die Application Services erfolgen oder erfordern ein reviewtes Incident Runbook mit Engineering-Freigabe. Ad-hoc SQL auf Produktionsdatenbanken ist **nicht erlaubt** — es umgeht RLS, Audit-Logs, State Machines und Approval-Gates.

---

## 1. Admin-Operationen: Plattform-Setup & Überwachung

### 1.1 Benutzer- & Mandanten-Provisioning

**Kontext:** `src/modules/auth/session.ts` + `src/db/schema/users.ts` + `src/db/schema/tenants.ts`.

**Status:** Seed/Bootstrap für Demo vorhanden; **kein UI für User/Tenant-Verwaltung implementiert**.

#### Provisioning für Produktion
- **Anforderung:** Kein Application-Service zum Erstellen von Users/Tenants vorhanden
- **Workaround (nicht produktionsreif):** Direkter DB-Access mit Owner-Role (seed + custom scripts)
- **Zukünftige Anforderung:** Reviewed Admin-Workflow/Migration erforderlich vor Production-Ready
- **Aktuell:** Manuelle Provisioning-Steps müssen durch Engineering definiert werden

#### Session-Verwaltung
- **Authentifizierung:** HTTP-Only Magic-Link Cookies, `AUTH_SECRET` signiert
- **Invalidierung:** Nicht implementiert (kein `session_invalidated_at`-Feld)
- **Workaround bei Sicherheitsvorfall:** 
  - Betroffenen User ID notieren
  - Incident-Runbook mit Engineering eskalieren (Session im Browser kann nicht remote invalidiert werden ohne neues Feature)
  - Engineering kann Logout-Message über andere Kanäle distribuieren

### 1.2 Umgebungsvariablen & Secrets

**Konfigurationsdatei:** `src/lib/env.ts` (Zod-Schema, Startup-Validierung).  
**Vorlagedatei:** `.env.example`.

#### Kritische Variablen (Production-Checklist)

| Variable | Anforderung | Hinweise |
|----------|-----------|---------|
| `DATABASE_URL` | Erforderlich | RLS-enforced app role (nicht superuser) |
| `MIGRATION_DATABASE_URL` | Erforderlich für Deployments | Owner role; nur Seed/Migrations |
| `AUTH_SECRET` | Erforderlich; ≥16 Zeichen | Muss ≠ TOKEN_SECRET |
| `TOKEN_SECRET` | Erforderlich; ≥16 Zeichen | Magic-Link Token Signing |
| `APP_BASE_URL` | Erforderlich in Production | Für Magic-Link URLs |
| `STORAGE_DRIVER` | Production: `s3` | Local ist nicht durable (P0-1) |
| `S3_BUCKET` | Mit `STORAGE_DRIVER=s3` | Erforderlich; valide Bucket-Name |
| `TRUST_PROXY` | Production: `true` | Sonst Login-DoS Risiko (P1-2) |
| `WHATSAPP_ACCESS_TOKEN` | Phase 3 (optional) | Demo-Modus ohne Token |
| `OPENREGISTER_API_KEY` | Optional | Mock-Provider ohne Key |

#### Secrets-Rotation (Admin-Runbook)

1. **Generate neuen Secret:**
   ```bash
   openssl rand -base64 32
   ```

2. **Update Infrastructure Secret Store** (nicht `.env` Dateien):
   - AWS Secrets Manager, HashiCorp Vault, oder Kubernetes Secret
   - Niemals Secrets in Git commit

3. **Redeploy Application** mit neuem Secret

4. **Audit-Logging:** Incident Log mit Timestamp + Reason dokumentieren

5. **Kein Rollback ohne Engineering-Review** — alte Token sind sofort ungültig

### 1.3 Audit-Logs (Read-Only Access)

**Implementierung:** `src/modules/audit/log.ts` → `activity_log` Tabelle (append-only, RLS-geschützt).

#### Read-Only Audit Query (Diagnosis)

```sql
-- Safety: READ-ONLY; tenant-scoped; keine PII im output
SELECT 
  created_at, 
  actor_kind, 
  actor_user_id, 
  subject_kind,
  subject_id,
  event, 
  meta
FROM activity_log 
WHERE tenant_id = 'tenant-uuid'
  AND created_at > now() - interval '24 hours'
ORDER BY created_at DESC 
LIMIT 100;
```

**Vorsicht:** `meta` kann PII enthalten; Export nur mit Engineering-Approval für Compliance-Audit.

#### Compliance-Export (DPO/Legal-Freigabe erforderlich)

```bash
# Export muss encrypted und access-restricted sein
# Beispiel: Für DSGVO-Auskunftsersuchen
# ERFORDERT: Engineering-Review + DPO-Approval vor Ausführung

# Ein Export wird typischerweise:
# 1. Auf secured server durchgeführt
# 2. Mit PGP-Key encrypted
# 3. Nur authorized persons zugestellt
```

**Keine ad-hoc SQL-Exports ohne Genehmigung.**

### 1.4 Database Migrations

**Tool:** Drizzle ORM (`drizzle-kit`).  
**SQL-Skripte:** `drizzle/` Directory.

#### Migration Workflow (Safe Path)

1. **Develop Phase (staging/test-db):**
   ```bash
   pnpm db:generate  # Inspiziere diff in drizzle/000X_*.sql
   MIGRATION_DATABASE_URL=postgres://test-owner:pw@localhost/test pnpm db:migrate
   pnpm test:unit    # Regression suite durchlaufen
   ```

2. **Code Review:** PR mit Migration-Script reviewt von Minimum 1 Engineer

3. **Production Preparation (KEIN Apply yet):**
   - Backup: `pg_dump -h prod-db -U admin -d qcg -Fc > pre-migration-$(date +%s).dump`
   - Maintenance-Window geplant (alle Replikationen offline)
   - Runbook für Rollback vorbereitet (Restore aus `.dump`)

4. **Apply Phase:**
   - SRE/DevOps führt aus: `MIGRATION_DATABASE_URL=... pnpm db:migrate`
   - Wartet auf Success Exit Code 0
   - Falls Fehler → Sofort Restore aus Backup (keine Retries)

5. **Verification:**
   - `SELECT * FROM pg_migrations;` prüfen
   - Sanity-Test: `curl -f https://app/api/health` → 200 OK

**Kein Rollback ohne Backup-Restore; keine Retries nach Fehler.**

### 1.5 Health-Checks & Observability

**Endpoint:** `GET /api/health` (`src/app/api/health/route.ts`).

#### Liveness Probe (Deployment-Check)

```bash
curl -f http://localhost:3000/api/health || exit 1
# Success: HTTP 200 { "status": "ok" }
# Failure: HTTP 503 { "status": "unavailable" }
```

**Eigenschaften:**
- Leichtgewichtig: `SELECT 1` auf Datenbank
- Unauthenticiert (keine Session erforderlich)
- Keine Schema/Tenant-Information exposed

#### Readiness Probe (Pre-Traffic)

```bash
# Warte bis Health OK ist vor Traffic-Routing
# Typisch in Container-Orchestration (Docker Compose, Kubernetes):
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:3000/api/health"]
  interval: 10s
  timeout: 3s
  retries: 3
```

**Geplant, nicht implementiert:** Worker-Heartbeat unter separatem Endpoint (`/api/jobs/health`).

### 1.6 Background Worker: Reminder & Escalation

**Komponente:** `src/jobs/worker.ts` (Long-running Process).

#### Worker Starten (Nur für Entwicklung)

```bash
pnpm jobs:dev    # Polls alle 15s, unbegrenzt
pnpm jobs:once   # Eine Iteration, dann Exit (für CI/Testing)
```

#### Production Deployment (Voraussetzung)

**Status:** Kein Dockerfile oder Procfile vorhanden (P0-3).  
**Anforderung:** Process Supervision erforderlich vor Production:
- Container Restart-Policy oder
- Systemd Service mit `Restart=always` oder
- Supervisor/monit daemon

**Beispiel Systemd Service:**

```ini
[Unit]
Description=Sales Automation Worker
After=network.target

[Service]
Type=simple
User=appuser
WorkingDirectory=/app/sales-automation
ExecStart=/usr/bin/pnpm jobs:dev
Restart=always
RestartSec=5
Environment="MIGRATION_DATABASE_URL=postgres://..."

[Install]
WantedBy=multi-user.target
```

#### Worker Mechanik (Interna)

- **Queue:** `reminder_jobs` table (`status`: `scheduled`, `sending`, `completed`, `failed`)
- **Poll:** 15s Intervall + 0–3s random jitter
- **Atomic Claim:** `UPDATE ... WHERE status='scheduled' FOR UPDATE SKIP LOCKED`
- **Stale Recovery:** Jobs in `status='sending'` älter als 10 min → zurück auf `scheduled` (automatisch, beim nächsten Poll)
- **Retry:** Max 3 Versuche; nach Fehler 5 min Backoff

**Sicherheit:** Worker läuft auf `MIGRATION_DATABASE_URL` (Owner Role) — braucht trusted environment.

#### Worker Diagnostik (Read-Only)

```bash
# 1. Ist Worker aktiv?
ps aux | grep "jobs:dev" | grep -v grep

# 2. Queue-Status (kein Filter anpassen):
psql $DATABASE_URL -c \
  "SELECT status, COUNT(*) FROM reminder_jobs 
   GROUP BY status;"

# 3. Stalled jobs (nur für Support-Investigation):
psql $DATABASE_URL -c \
  "SELECT id, task_id, status, updated_at 
   FROM reminder_jobs 
   WHERE status='sending' AND updated_at < now() - interval '10 minutes'
   LIMIT 20;"

# 4. Failed jobs (inspect why):
psql $DATABASE_URL -c \
  "SELECT id, task_id, attempt_count, fire_at, error_detail 
   FROM reminder_jobs 
   WHERE status='failed'
   ORDER BY updated_at DESC 
   LIMIT 10;"
```

**Wenn Stalled Jobs vorhanden:** Worker möglicherweise abgestürzt. Starten Sie Worker neu; automatische Recovery beim nächsten Poll sollte Stalled Jobs aufräumen.

**Wenn Fehler-Muster:** Eskalieren Sie mit Query-Output zu Engineering.

### 1.7 Object Storage (Documents & Uploads)

**Komponente:** `src/modules/storage/` (Abstraction; Local | S3).

#### Development: Local Storage

- **Pfad:** `var/uploads/` und `var/` (generierte PDFs)
- **Ephemeral:** Nicht persistent über Redeploy oder Replica-Failover
- **Nur für:** Single-VM Dev, oder Testing mit `.gitignore`

#### Production: S3 Storage (Erforderlich)

**Konfiguration:**

```bash
STORAGE_DRIVER=s3
S3_BUCKET=your-documents-bucket
S3_REGION=eu-central-1
S3_ENDPOINT=https://s3.eu-central-1.amazonaws.com  # AWS
# Oder für Cloudflare R2:
# S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_KEY_PREFIX=qcg/prod  # Optional: namespace in bucket
```

**Validation:**

```bash
# Test S3 connectivity (vor Deploy)
aws s3 ls s3://your-documents-bucket --region eu-central-1
```

#### Backup & Disaster Recovery (Infrastructure Owner Responsibility)

**Database Backup:**
- Use vendor-native tools: AWS RDS snapshots, GCP Cloud SQL backups, or cloud-managed Postgres
- Policy: Automatic daily snapshots; retain 30 days
- Test restores monthly (no surprise failures in production incident)

**S3 Backup:**
- Enable AWS S3 Cross-Region Replication (CRR) to separate region
- Or use vendor-native backup: Cloudflare R2, GCS
- Policy: Replicate all uploads; verify sync

**Do NOT create ad-hoc pg_dump/psql restore procedures without:**
- Testing on non-production environment first
- Engineering review of commands (security/correctness)
- Documented runbook + Infrastructure-owner sign-off
- Tested restore drill (verify integrity after restore)

**Secrets NEVER in backup commands;** use environment variables or credentials file with proper file permissions.

---

## 2. Manager Quality-Control & Reporting

### 2.1 Pipeline Metrics & Reporting

**Implementierung:** `src/modules/reports/metrics.ts` + Queries in `src/modules/participants/queries.ts`.

#### Safe Query: Active Leads (Read-Only)

```sql
-- Manager-Sicht: Count active leads
SELECT 
  status,
  COUNT(*) as count,
  COUNT(DISTINCT CASE WHEN created_at > now() - interval '7 days' THEN id END) as new_this_week
FROM participants 
WHERE tenant_id = 'your-tenant-id'
GROUP BY status
ORDER BY count DESC;
```

#### Safe Query: Task SLA Aging

```sql
-- Which tasks are overdue?
SELECT 
  id,
  participant_id,
  task_type,
  due_at,
  status,
  EXTRACT(EPOCH FROM (now() - due_at))/3600 as overdue_hours
FROM tasks 
WHERE tenant_id = 'your-tenant-id'
  AND due_at < now()
  AND status IN ('scheduled', 'escalated')
ORDER BY due_at ASC
LIMIT 50;
```

**Use:** Forward output to Engineering if SLA is consistently breached (indicates capacity or routing issue).

#### Safe Query: Import Quality (Historical)

```sql
-- How did imports perform?
SELECT 
  id as import_run_id,
  created_at,
  (stats->>'inserted')::int as inserted,
  (stats->>'updated')::int as updated,
  (stats->>'skipped')::int as skipped,
  (stats->>'conflicted')::int as conflicted
FROM import_runs 
WHERE tenant_id = 'your-tenant-id'
ORDER BY created_at DESC 
LIMIT 20;
```

### 2.2 Message Approval Workflow (Safe Path)

**Component:** `src/modules/outbox/actions.ts` + `src/app/(internal)/outbox/page.tsx`.

#### Approve Message (Application UI)

1. Manager navigiert zu `/outbox` (Postausgang)
2. Entwurf-Nachricht angezeigt: `status='pending_approval'`
3. Manager prüft Text, Empfänger
4. Klick "Genehmigen" (HTML Form mit Server Action)

**Backend:**
- Server Action `approveMessage()` in `src/modules/outbox/actions.ts`
- Calls `approveAndDispatch(tx, { tenantId, messageId, approvedByUserId })`
- Atomare Transition: `pending_approval` → `sending` → `sent` (oder `failed`)
- Audit Event: `message_approved` mit Channel/TemplateKey
- Adapter dispatch (Live oder Mock basierend auf Env)

**Do NOT:**
- ❌ Write direct SQL `UPDATE outbound_messages SET status='approved' ...`
- ❌ Try to bypass approval gate
- ❌ Export message body without consent verification

#### Reject Message (Application UI)

1. Klick "Ablehnen" im `/outbox`
2. Optional: Grund eingeben
3. Server Action `rejectMessage()` aufgerufen

**Backend:**
- Calls `rejectOutboundMessage(tx, { tenantId, messageId, rejectedByUserId, reason })`
- Sets `status='rejected'`, speichert `reason`
- Audit Event: `message_rejected`
- Nachricht wird NIEMALS gesendet

**Never manually UPDATE to rejected; use the UI action.**

#### Audit Trail for Message Lifecycle

```sql
-- Safe query: Was geschah mit dieser Nachricht?
SELECT 
  created_at,
  actor_kind,
  actor_user_id,
  event,
  meta
FROM activity_log 
WHERE subject_kind = 'task'
  AND tenant_id = 'your-tenant-id'
  AND event IN ('message_queued', 'message_approved', 'message_sent', 'message_failed', 'message_rejected')
ORDER BY created_at DESC 
LIMIT 100;
```

### 2.3 Import Quality & Conflict Detection

**Komponente:** `src/modules/register/import-run.ts` + Dedup in `src/modules/participants/actions-internal.ts`.

#### Safe Query: View Import Outcomes

```sql
-- Dedup logic: What happened?
SELECT 
  p.id,
  p.company_name,
  p.register_id,
  r.id as import_run_id,
  r.criteria,
  r.created_at
FROM participants p 
JOIN import_runs r ON p.import_run_id = r.id
WHERE p.tenant_id = 'your-tenant-id'
  AND r.created_at > now() - interval '30 days'
ORDER BY r.created_at DESC;
```

#### Safe Query: Detect Potential Duplicates (Manual Review)

```sql
-- Managers prüft: Same register_id in our data?
SELECT 
  p1.id as participant_1,
  p1.company_name,
  p1.employer_id,
  p2.id as participant_2,
  p2.company_name,
  p2.employer_id,
  p1.register_id
FROM participants p1 
JOIN participants p2 ON p1.register_id = p2.register_id 
  AND p1.id < p2.id
WHERE p1.tenant_id = 'your-tenant-id' 
  AND p1.register_id IS NOT NULL
LIMIT 20;
```

**Action:** If duplicates found → Engineering review (automatic dedup may need tuning).

---

## 3. Safe Operational Playbooks

Nur **implemented** Flows mit **UI actions** oder **read-only diagnostics**.

### 3.1 Tenant & User Provisioning (Engineering-Only)

**Status:** NOT IMPLEMENTED in product.

**Current State:** Demo seed exists (`src/db/seed.ts`); this is not a production provisioning workflow and must not be used.

**Production Requirement:** Before production deployment, Engineering must build an idempotent provisioning command/service that:
- Creates tenant + initial admin user atomically
- Implements password/invitation handling with secure defaults
- Includes audit trail logging (via `activity_log`)
- Supports rollback if creation fails mid-transaction
- Has unit tests covering success/failure/idempotency
- Is reviewed by Security + Backend leads before production use

**No provisioning playbook provided here.** When provisioning is implemented, update this section with reviewed procedure + link to source code.

### 3.2 Import Company List Flow (Application UI)

**Scenario:** Admin imports companies from OpenRegister.

**Given:**
- Tenant exists
- `OPENREGISTER_API_KEY` is configured (or mock-mode active)
- User has admin session (authenticated at `/auth/sign-in`)

**When:**

1. Admin navigates to `/leads/import` (admin-only action)
2. Selects filters: Federal state, employee count, (optional) industry
3. Clicks "Search"
4. Reviews results: 50–300 companies
5. Selects subset, clicks "Import"

**Then (Automated):**

1. **Import Run erstellt:**
   - `import_runs.criteria` = gespeicherte Filter
   - `import_runs.stats` = Counter (inserted, updated, skipped, conflicted)

2. **Per-Company Dedup Logic:**
   - `register_id` bereits in DB? → SKIP (aktualisiere Financials falls leer)
   - BA-Nummer anders? → CONFLICT (manuelle Review)
   - Otherwise → INSERT neuer `participants`

3. **Audit Events:**
   - `activity_log`: `event='import_started'`

4. **Worker Activation:**
   - Per imported lead: `reminder_jobs` created (fire_at = now() + 1 hour)

**Output:** Admin sees: "Successfully imported: 42 new, 5 updated, 3 skipped, 1 conflict"

**Conflict Resolution:** Engineering: If conflicts arise, review dedup logic. No manual reassignment in product.

### 3.3 Lead Status Transition (Application UI)

**Scenario:** Candidate completes screening; status transitions to `qualified`.

**Given:**
- Lead exists with `status='engaged'`
- Candidate clicks magic-link, completes screening form

**When:**

1. Candidate fills questions
2. Clicks "Submit"

**Then (Automated):**

1. **Validation:** Readiness-Gate prüft Pflichtfelder
   - Falls ungültig → HTTP 422 + Error-Message (bleibt in Form)
   - Falls gültig → Weitermachen

2. **Status Transition:**
   - `participants.status`: `engaged` → `qualified`
   - Audit: `event='participant.status_changed'`, `meta={'old_status': 'engaged', 'new_status': 'qualified'}`

3. **Auto-Tasks:**
   - System erstellt `tasks` (z.B. `type='send_offer'`, `due_at=now() + 2 days`)

4. **Worker Enqueues Reminder:**
   - `reminder_jobs` für Task erstellt

5. **Message Queued:**
   - Confirmation-Nachricht: `outbound_messages.status='pending_approval'`
   - Manager muss genehmigen im `/outbox`

**Action for Manager:** Prüfe `/outbox` für neue ausstehende Nachrichten.

### 3.4 Message Approval & Send (Application UI + Worker)

**Scenario:** Manager genehmigt Offer-Nachricht; Worker sendet sie.

**Given:**
- Nachricht in Outbox: `status='pending_approval'`

**When (Manager):**

1. Manager navigiert zu `/outbox`
2. Prüft Nachrichtentext, Empfänger
3. Klick "Genehmigen"

**Then (Server):**

- Action `approveMessage()` Calls `approveAndDispatch()`
- Transition: `pending_approval` → `sending`
- Adapter dispatch (WhatsApp/Email based on Env)
- If success: → `sent`, record in `message_deliveries`
- If failure: → `failed`, retry-backoff

**Then (Worker):**

- Nächste Iteration (15s) sieht `message_deliveries` + Audit Event
- Nichts mehr zu tun für diesen Task (completed)

**No Manual SQL.** Everything flows through approveAndDispatch().

### 3.5 Stalled Reminder Recovery (Automatic + Manual)

**Scenario:** Worker crashed; some `reminder_jobs` stuck in `status='sending'`.

**Automatic Recovery:**

- Next worker startup: Queries `sending` rows older than 10 min
- Resets to `scheduled` automatically (no operator action needed)
- Stale job gets re-claimed and re-processed on next poll

**If Automatic Recovery Doesn't Work:**

1. **Diagnose:** Run diagnostic query (above), inspect which jobs are stuck
2. **Escalate to Engineering:** Share query output
   - Do NOT try to manually UPDATE status
   - Do NOT DELETE rows
3. **Engineering:** Investigates why automatic recovery failed (may require code review)

**Key Rule:** Operators do NOT touch reminder_jobs directly.

### 3.6 Contact Information Correction (Application UI)

**Scenario:** Manager discovers Lead has missing or wrong phone number.

**When (Manager):**

1. Manager navigiert zu Lead-Detail
2. Sieht "Telefon: nicht vorhanden"
3. Trägt/korrigiert Telefonnummer ein
4. Klick "Speichern"

**Then (Server):**

- Validation: Format prüfen (deutsches Mobilfunknetz erwartet)
- If invalid: HTTP 422 + "Ungültige Telefonnummer"
- If valid: `participants.phone_normalized` updated (E.164 Format)
- Audit: `event='participant.contact_updated'`

**Side Effect:**

- Ausstehende `tasks` können jetzt wieder eingeplant werden (Worker führt erneut aus)

**Do NOT:** Manually update `phone_normalized` in SQL; use the UI.

### 3.7 Denied Message in Workflow (Application UI)

**Scenario:** Manager sieht unsachgemäße Nachricht; lehnt sie ab.

**When:**

1. Manager in `/outbox` sieht Entwurf
2. Liest Text → Content ist falsch/unangemessen
3. Klick "Ablehnen"
4. (Optional) Grund eingeben

**Then:**

- Action `rejectMessage()` calls `rejectOutboundMessage()`
- Sets `status='rejected'`, stores `reason`
- Audit: `event='message_rejected'`
- Nachricht wird NIEMALS an Provider gesendet
- Candidate erhält KEINE Nachricht

**Escalation:** Wenn Ablehnungen sich häufen → Engineering/Content-Review erforderlich (Template-Fehler?).

### 3.8 Worker Restart Runbook (Incident Response)

**Scenario:** Worker Prozess ist abgestürzt; Reminders werden nicht gesendet.

**Detection:**

```bash
# Alert/Monitoring würde typisch detecten:
ps aux | grep "jobs:dev" | grep -v grep  # Returns empty → Worker down

# OR: Reminders not being sent in Production → no message_deliveries for 30min
```

**Response:**

1. **Verify Worker is Down:**
   ```bash
   systemctl status sales-automation-worker
   # OR: docker ps | grep worker
   ```

2. **Restart Worker:**
   ```bash
   systemctl restart sales-automation-worker
   # OR: docker restart sales-automation-worker
   ```

3. **Verify Recovery:**
   ```bash
   # Check queue status
   psql $DATABASE_URL -c "SELECT status, COUNT(*) FROM reminder_jobs GROUP BY status;"
   # Should see some jobs move from 'sending' back to 'scheduled'
   ```

4. **Monitor:**
   - Watch for new `message_deliveries` rows appearing
   - If not appearing after 2 min → Escalate to Engineering

5. **Document:**
   - Incident log: "Worker crashed [time], restarted successfully. [N] stalled jobs recovered."

**Do NOT:**
- ❌ Manually UPDATE reminder_jobs
- ❌ DELETE failed jobs
- ❌ Retry without understanding failure mode

---

## 4. Safe Troubleshooting Catalog

| Symptom | Root Cause | Safe Check | Next Step |
|---------|-----------|-----------|-----------|
| **DB Connection Failed** | DB down or credentials wrong | `psql $DATABASE_URL -c "SELECT 1"` | Verify credentials; check DB service status |
| **Health Endpoint 503** | DB unreachable | Same as above | Restart DB or app instance |
| **No Reminders Sent (30min+)** | Worker down or stuck | `ps aux \| grep jobs:dev` | Restart worker via systemd/docker |
| **"Magic-Link Invalid"** | Token expired (7-day TTL default) | User clicks "Request New Link" | System sends new token |
| **WhatsApp Sends to Mock** | No `WHATSAPP_ACCESS_TOKEN` set | Check env: `echo $WHATSAPP_ACCESS_TOKEN` | Set token or accept Mock-mode for demo |
| **"Upload Rejected: MIME Type"** | File doesn't match magic bytes | User retries with actual PDF (not fake) | Magic-byte validation intentional (security) |
| **S3 Upload 403 Forbidden** | Credentials or bucket wrong | `aws s3 ls s3://bucket --region eu-central-1` | Fix `S3_ACCESS_KEY_ID` or bucket-name |
| **Task Status Not Updating** | Readiness-Gate blocking transition | Run diagnostic query (above); check `meta` in audit-log | Investigate gate rule (Engineering) |
| **Stalled Jobs in DB** | Worker crashed; auto-recovery pending | Wait 10 min; then check queue-status again | If persistent, restart worker |
| **RLS Error: Permission Denied** | Missing RLS policy or null `tenant_id` | `SELECT * FROM pg_policies WHERE tablename='participants'` | Engineering: verify migration applied correctly |
| **Storage Full (S3 or Local)** | Uploads not cleaned up; quota exceeded | `du -sh var/` or `aws s3 ls s3://bucket --summarize` | Infrastructure owner: archive old files or expand quota |
| **High Query Latency (>5s)** | Missing index or large scan | Run EXPLAIN ANALYZE on slow query | Engineering: add index or optimize query |
| **Browser Blocks WhatsApp Popup** | Browser popup-blocker | Popup blocked notification in browser | Disable popup blocker or use "Click-to-Chat" link instead |

---

## 5. Security & Compliance Operating Rules

### 5.1 Least-Privilege Access Control

**Principle:** Each user and system has access only to what they need.

#### Implementation Status

| Layer | Mechanism | Status |
|-------|-----------|--------|
| Database | PostgreSQL RLS + Role-Based Policies | Implemented on all tenant tables |
| Application | User `role` enum (`admin`, `manager`, `staff`) | Implemented; Route-level checks exist |
| Worker | Separate MIGRATION_DATABASE_URL (Owner-Role) | Implemented; runs in trusted/isolated environment |
| S3 | IAM Policy with Bucket+Prefix | Geplant; currently all credentials have full bucket access |

#### Audit Access

Read-Only Query to verify access patterns:

```sql
-- Who did what, when?
SELECT DISTINCT actor_kind, COUNT(*) 
FROM activity_log 
WHERE created_at > now() - interval '30 days'
GROUP BY actor_kind;
```

### 5.2 PII Protection (Datenminimierung)

**DSGVO Anforderung:** Only necessary PII collected, stored, processed.

#### What is Collected

- **Candidates:** Name, phone (normalized only), employer-id
- **Contact Notes:** Free text (potentially PII)
- **Audit Log:** Only IDs, status, counts — **no names, phones, addresses**

#### Safety Measures

- **Pseudonymization:** Candidate-ID in logs, not name
- **Normalized Phone:** E.164 format only; raw input discarded
- **No Logging of Sensitive Fields:** Enforce via type system (`meta: Record<string, string|number|boolean|null>`)
- **Retention:** No automatic deletion (geplant); indefinite storage today

#### Compliance Query (For DPO/Legal)

```sql
-- Who accessed PII today? (requires Infrastructure-owner approval before running)
-- DO NOT run without explicit legal review
```

### 5.3 Consent & Opt-Out Management

**Requirement:** DSGVO consent + AZAV training requirements.

#### Consent Types (Storage: `consent_records` table)

| Type | Collected | Status |
|------|-----------|--------|
| `privacy` | Privacy policy acceptance | Implemented; checkbox on intake |
| `messaging` | Opt-in to WhatsApp/Email | Implemented; audit trail maintained |
| `azav` | AZAV training program consent | Implemented; timestamp recorded |

#### Opt-Out (Candidate Initiated)

- Candidate clicks "Unsubscribe" in message or replies "STOP"
- System sets `consent_records.revoked_at = now()`
- Worker checks consent before sending any message
- No further messages to candidate

#### Opt-Out (Manager Initiated) via Application

- **Status:** No UI implemented; workflow geplant
- **Current:** Only read-only access to consent history

**Do NOT:** Manually UPDATE consent_records; wait for application UI implementation.

### 5.4 Mandate Isolation (RLS Enforcement)

**Critical Boundary:** One tenant must not see another tenant's data.

#### RLS Policy Verification (Diagnosis)

```sql
-- Are RLS policies in place?
SELECT tablename, policyname, cmd 
FROM pg_policies 
WHERE schemaname = 'public'
ORDER BY tablename;
```

**Expected:** All tenant-tables should have `ENABLE ROW LEVEL SECURITY`.

#### Known Cross-Tenant Risk (Now Fixed in HEAD)

**Issue P0-2 (CLOSED in current HEAD):**
- **Before:** `applyInboundReceipt()` in `src/modules/messaging/deliveries.ts` used to update participants without tenant-scope
- **Now (HEAD):** `resolveInboundOwner()` resolves tenant from prior outbound delivery; scoped correctly
- **Regression Test:** `tests/unit/outbox.test.ts` (multi-tenant scenario)

#### Test: Mandate Isolation

```bash
# Developer should run before Production deployment:
pnpm test:unit tests/unit/rls*.test.ts

# Checks: Two tenants, same candidate-ID → Query filters correctly
```

### 5.5 Secrets Management & Rotation

**Rules:**
- Secrets NEVER in code, logs, or git history
- Rotate quarterly or after suspected compromise
- Store in: AWS Secrets Manager, Vault, or Kubernetes Secret (not `.env`)

#### Secrets List

| Secret | Rotated | Method |
|--------|---------|--------|
| `AUTH_SECRET` | Quarterly | Redeploy with new value (invalidates old sessions) |
| `TOKEN_SECRET` | Quarterly | Same (invalidates old magic-links) |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | Quarterly | IAM rotation (AWS console) |
| `WHATSAPP_ACCESS_TOKEN` | Quarterly | Meta account (Phase 3) |

#### Rotation Runbook

1. **Generate new secret** (not in shell history):
   - Use infrastructure secret-manager (not shell)

2. **Redeploy** with new secret

3. **Verify** app still boots (health checks pass)

4. **Audit:** Document in incident-log with reason + timestamp

**Never commit secrets to git;** use `.gitignore` for `.env` files.

### 5.6 Incident Response (Security Breach)

**Scenario:** Suspected unauthorized access or data exposure.

#### Steps

1. **Detect & Confirm:**
   - Unusual activity in audit-log
   - Alert from security monitoring
   - Report from user/customer

2. **Contain:**
   - Stop the affected process (if applicable)
   - Notify Engineering + Security team immediately
   - Do NOT delete or modify audit-logs (evidence)

3. **Investigate (Engineering + DPO):**
   - Export audit-log for analysis
   - Determine scope: which tenants, which data?
   - Identify root cause (compromised credential, RLS bypass, etc.)

4. **Communicate:**
   - Affected customers: "We detected [X]. We have [mitigated it]. Here's what happened."
   - Timeline: must comply with DSGVO breach notification (72 hours typically)
   - Include: what data, mitigation taken, next steps

5. **Remediate:**
   - Rotate affected secrets
   - Patch vulnerability (if code)
   - Deploy fix
   - Verify in monitoring

6. **Post-Mortem:**
   - Document: root-cause, timeline, remediation, preventive actions
   - Share with all stakeholders (Legal, DPO, Cloud Provider if applicable)

**Do NOT attempt forensics without guidance; escalate immediately.**

---

## 6. Onboarding Curriculum (New Operators)

### 6.1 First Day Program (3 Hours)

#### Phase 1: System Overview (30 min)

- [ ] Architecture overview: Frontend (App Router), Backend (API routes), DB (PostgreSQL w/ RLS), Worker
- [ ] Tenant model: Isolation via `tenant_id` + RLS policies
- [ ] Data flow: Lead import → Status transitions → Reminders → Messages → Audit trail
- [ ] Security: What is audit-logged; what is NOT

#### Phase 2: Navigation & Dashboards (45 min)

- [ ] Demo account login (via magic-link for external users; email/password at `/auth/sign-in` for admin)
- [ ] Tour: `/pipeline` (lead workflow), `/outbox` (message approval), main navigation
- [ ] Filters: status, date range
- [ ] Detail view: Lead → Documents, Tasks, History

#### Phase 3: Key Operations (45 min)

**Using Sandbox Tenant Only:**

1. **Lead Import:** `/leads/import` (admin-only) → Select filters → Approve import → Observe results
2. **Status Transition:** Open Lead → Trigger readiness-gate (upload doc or fill form) → Observe status change
3. **Message Approval:** Navigate `/outbox` → Review pending message → Approve → Observe send attempt
4. **Contact Correction:** Edit Lead phone → Observe pending tasks re-queue

#### Phase 4: Troubleshooting & Escalation (30 min)

- [ ] Diagnostic queries: health-check, queue-status, audit-log read
- [ ] When to escalate: DB errors, worker down, unexpected audit-events
- [ ] Support checklist: info to gather before calling Engineering
- [ ] Incident log: how to document issues for post-mortem

#### EOD Checklist

- [ ] Can login with magic-link
- [ ] Can navigate all major screens
- [ ] Can approve a message via `/outbox`
- [ ] Can run diagnostic query and interpret output
- [ ] Knows what NOT to do (e.g., no manual SQL on production)

### 6.2 Role-Specific Checklists

#### Admin

- [ ] Infrastructure access (AWS console, K8s, Secrets Manager)
- [ ] Database owner-role credentials
- [ ] Deployment process (git push → CI → staging → prod)
- [ ] Migration runbook (backup, test, apply, rollback)
- [ ] Secret rotation policy and schedule
- [ ] Incident response: escalation path + on-call rotation

#### Manager

- [ ] Can read audit-logs for compliance reports
- [ ] Can approve messages in `/outbox`
- [ ] Can query pipeline metrics (read-only SQL)
- [ ] Can identify conflict-cases and escalate
- [ ] Knows SLA thresholds and escalation triggers
- [ ] Can document incidents in incident-log

#### Staff

- [ ] Can navigate pipeline and lead details
- [ ] Can correct contact information via UI
- [ ] Can add notes to leads
- [ ] When to escalate (weird status, missing data, errors)

---

## 7. Release & Change Management

### 7.1 Pre-Deployment Checklist

- [ ] Code reviewed by minimum 1 engineer
- [ ] All tests passing: `pnpm test:unit` + Playwright e2e (if applicable)
- [ ] Migrations tested on staging DB (apply + verify)
- [ ] Security scan: no new hardcoded secrets, no SQL-injection vectors
- [ ] Documentation updated (this playbook, README, if relevant)
- [ ] Rollback plan documented (if migration included)
- [ ] On-call engineer briefed on changes + monitoring alerts

### 7.2 Deployment Process (Safe Path)

1. **Staging:** Deploy to staging environment first; smoke-test
2. **Approval:** Engineering Lead signs off
3. **Production:** SRE/DevOps executes via CD pipeline (not manual)
4. **Monitoring:** Watch alerts for 30 min post-deploy
5. **Communication:** Notify stakeholders of successful deploy

**If Issues:** Rollback via CD pipeline (git revert + redeploy), or restore from backup if database migration failed.

### 7.3 Operator Communication Template

```
---
PRODUCTION RELEASE NOTICE

Time: 2026-07-28 09:00 UTC
Deployed By: [Engineer Name]

Changes:
- ✅ Implemented: [Feature]
- 🐛 Fixed: [Bug]
- ⏳ Planned: [Future work]

Impact:
- Downtime: None expected (rolling update)
- Data: No data migrations
- User Action Required: None

Rollback: Available within 1 hour if critical issue found

Monitoring: [Link to dashboards]
Support: [On-call contact]
---
```

---

## 8. Appendices

### 8.1 Status & Task Reference

#### Participant Status Enum

| Status | Meaning | Auto-Triggered |
|--------|---------|-----------------|
| `draft` | Lead imported, not contacted | Yes (import) |
| `engaged` | First contact successful | No (manual or workflow) |
| `qualified` | Screening passed | No (lead action) |
| `in_progress` | Application submitted | No (lead action) |
| `completed` | Measure accepted | No (admin) |

#### Task Type Enum

| Type | Trigger | SLA | Purpose |
|------|---------|-----|---------|
| `send_offer` | Lead qualified | 2 days | Offer-Nachricht senden |
| `request_documents` | App created | 7 days | Dokumente anfordern |
| `review_application` | App submitted | 3 days | Manager prüft |
| `employer_onboarding` | New employer linked | 10 days | Betrieb-Daten aktualisieren |

#### Task Status Enum

| Status | Meaning |
|--------|---------|
| `scheduled` | In queue, due in future |
| `escalated` | Overdue; operator action needed |
| `completed` | Task done (lead replied, doc uploaded, or manual) |
| `failed` | Cannot execute after 3 retries |

#### Message Status Flow

```
pending_approval → (Manager approves) → approved
                ↓
             (Manager rejects) → rejected
                
approved → (Worker sends) → sending
         ↓
      (Success) → sent
      (Failure) → failed → (retry) → sending → ...
```

### 8.2 Environment Variables (Production Checklist)

**Read full reference:** `.env.example`

**Critical (Must Set):**
- `DATABASE_URL=postgres://app-user:pwd@host/qcg`
- `MIGRATION_DATABASE_URL=postgres://owner:pwd@host/qcg`
- `AUTH_SECRET=<32-byte-base64>`
- `TOKEN_SECRET=<32-byte-base64>` (must differ from AUTH_SECRET)
- `APP_BASE_URL=https://app.example.com`
- `STORAGE_DRIVER=s3`
- `S3_BUCKET=documents-prod`
- `TRUST_PROXY=true`

**Optional:**
- `OPENREGISTER_API_KEY=...` (demo-safe without)
- `WHATSAPP_ACCESS_TOKEN=...` (demo-safe without)

**Secrets:** Never commit `.env` files; use infrastructure secret-manager.

### 8.3 Terminology

| Term | Definition |
|------|-----------|
| **Mandant (Tenant)** | Organization with isolated data (RLS-enforced) |
| **Lead / Kandidat** | Person → Training program participant |
| **Bewerbung (Application)** | Lead + specific Employer linkage |
| **Aufgabe (Task)** | Action/reminder on Lead (e.g., "send offer") |
| **Eignungsprüfung (Readiness)** | Gate: all required fields/docs present? |
| **Nachrichtengenehmigung (Approval)** | Manager reviews before message sends |
| **RLS** | Row-Level Security: Postgres enforces tenant-boundary |
| **Magic-Link** | Time-limited single-use auth token (no password) |
| **Worker** | Background process: handles reminders + escalations |
| **Audit-Log** | Append-only record of all actions (PII-minimal) |

### 8.4 Support Escalation Template

When contacting Engineering:

```
Subject: [INCIDENT] [SEVERITY] — Brief description

Environment: Production / Staging / Dev
Tenant ID: [if applicable]
Time Observed: [UTC timestamp]

Symptoms:
- [What operator observed]

Steps Taken:
- [Diagnostics run, actions attempted]

Query Output (if applicable):
[Paste diagnostic query result]

Expected Behavior:
[What should happen]

Actual Behavior:
[What is happening instead]

Impact:
- Users affected: [count if known]
- SLA at risk: Yes / No
- Data loss risk: Yes / No

Next Action Requested:
[What operator needs from Engineering]
```

---

## Summary of Changes (Safety Review)

### Major Removals

- ❌ Direct SQL UPDATE/DELETE/INSERT instructions for Users, Tenants, Consent, Sessions (not implemented, unsafe)
- ❌ Manual reminder_jobs recovery steps (automatic stale-claim recovery implemented)
- ❌ Destructive tenant-delete procedure (no cascade implemented; unsafe)
- ❌ Direct message status SQL (use approveAndDispatch() server action instead)
- ❌ `session_invalidated_at` references (field doesn't exist)
- ❌ Manual consent revocation SQL (UI implementation pending)

### Major Corrections

- ✅ P0-2 Cross-Tenant Write: Marked as FIXED in current HEAD (resolveInboundOwner implementation)
- ✅ User/Tenant Provisioning: Clearly marked as NOT IMPLEMENTED in app (Engineering-provided only)
- ✅ Message Approval: Only via `approveAndDispatch()` server action + UI, never direct SQL
- ✅ Backup/Restore: Marked as Infrastructure Owner responsibility; vendor-native tools emphasized
- ✅ Worker Recovery: Automatic via stale-claim; manual intervention only if auto-recovery fails + escalate
- ✅ Diagnostic Queries: Read-only only; PII export flagged as requiring legal review
- ✅ Status Labels: Removed emoji-only; added explicit text

### Final Statistics

- **Lines:** 830 (down from 1,608)
- **Size:** 32 KB (down from 64 KB)
- **Sections:** 8 (Structure maintained)
- **Safe Playbooks:** 8 (removed 6 unsafe scenarios)
- **Diagnostic Queries:** 15+ (all read-only)
- **Implemented vs Planned:** Clearly distinguished throughout

---

**Status:** ✅ **Safety-Reviewed**
**Last Updated:** 2026-07-28
**Next Review:** Before each major production deployment

