# QCG Antragsplattform – Grundlagen und Navigation

**Letztes Update:** 28. Juli 2026 (Korrektionen v1.1: Authentifizierung vs. Autorisierung, Access-Model-Validierung)  
**Version:** 1.1  
**Gültig für:** Codebase Version nach [Git Commit](https://github.com/codekessel/sales-automation)  

---

## Inhaltsverzeichnis

1. [Produktzweck und Umfang](#produktzweck-und-umfang)
2. [QCG-Kontext und Prozessverantwortung](#qcg-kontext-und-prozessverantwortung)
3. [Implementierungsstatus](#implementierungsstatus)
4. [Glossar und Datenmodell](#glossar-und-datenmodell)
5. [Multi-Mandantschaft und Dateneigentum](#multi-mandantschaft-und-dateneigentum)
6. [Rollen und Berechtigungen](#rollen-und-berechtigungen)
7. [Navigation und Seiten-Atlas](#navigation-und-seiten-atlas)
8. [Benutzerfachdatenmodell](#benutzerfachdatenmodell)
9. [Für Sie: Der schnelle Einstieg pro Rolle](#für-sie-der-schnelle-einstieg-pro-rolle)

---

## Produktzweck und Umfang

Die **QCG Antragsplattform** (Qualification Opportunities Act – Qualifizierungschancen-Gesetz) ist ein rollengestütztes Prozessassistenzsystem für die **End-to-End-Vermittlung und Onboarding** von Teilnehmenden in AZAV-zertifizierte Weiterbildungsmaßnahmen.

### Zielgruppen

- **Teilnehmende (Arbeitnehmer:innen)**: Employees seeking subsidized training
- **Arbeitgeber:innen**: Companies enrolled in the subsidy program
- **Verkaufsberater:innen (Consultants)**: Sales and eligibility specialists
- **Verwaltung (Operations/Backoffice)**: Internal administration and system admins
- **Externe Akteure** (optional): Employer service contacts, agency liaisons
- **Arbeitgeberservice (optional)**: Employer agency contacts for setup coordination

### Kernfunktionen

- **Lead-Pipeline**: Verwaltung von Kontakten und Statusübergängen entlang eines definierten Vertriebsfunnels
- **Verfügbarkeitsprüfung**: Mandatory 20h/week × 6 months gate vor der weiteren Bearbeitung
- **Aufgabenverwaltung**: Automatische Aufgabenvergabe und manuelle Task-Bearbeitung intern und extern
- **Unterlagen-Toolkit**: PDF-Generierung, Checklisten, Canvas-basierte Signaturen, digitale Unterschriftensammlung
- **Antragsbearbeitung**: Application status tracking und Ausgangspositionierung für die Arbeitsagenturbeschaffung
- **Arbeitgeberregistrierung**: Setup-Assistent für Betriebsnummern, Agenturservice-Status und Zeitmodelle
- **Multi-Signatur-Workflows**: Parallele Unterschriftensammlung mit Finalisierungssperrung
- **Outbound-Messaging-Queue**: WhatsApp, E-Mail, Magic Links mit Genehmigungspflicht vor Versand
- **Audit-Protokoll**: Ereignis-basierte Activity Log für alle Statusübergänge

---

## QCG-Kontext und Prozessverantwortung

### Gesetzliche Grundlage

Das Qualifizierungschancen-Gesetz (QCG) ermöglicht für beruflich unerfahrene oder unterbeschäftigte Beschäftigte einen Anspruch auf Qualifizierung mit Arbeitsentgeltzuschuss (AEZ) oder Eingliederungszuschuss (EGZ).

### Prüfumfang

Die Plattform automatisiert die **Qualifizierungsprüfung (§17 Anforderungen)** durch:

1. **Eligibility gates**: Verfügbarkeit, Finanzierungsstatus, Arbeitgeberstatus
2. **KPI-Tracking**: Kontakt-Rate, No-Show-Rate, Eignungstest-Rate, Arbeitgeberbewilligung, Antragsabsendequote
3. **Conformance audit**: Alle status transitions werden protokolliert (audit trail)
4. **Provenance tracking**: Herkunft aller leads (manual, register import, external feed)

### Integrationspunkte

- **Handelsregister-Import** (OpenRegister): Automatische Finanzanlysen und Unternehmensidentifikation
- **BA eService**: Export von Antragsdaten (nicht im MVP implementiert)
- **Eignungstests**: Externe Test-Provider über Konfiguration und Teilnehmer-ID
- **WhatsApp/E-Mail**: Meta Cloud API und Resend für Template-basierte Outbound-Kommunikation

---

## Implementierungsstatus

### Implementiert (Ready for Use) ✓

| Feature | Status | Referenz |
|---------|--------|----------|
| Lead-Erfassung, -Verwaltung und Status-Pipeline | ✓ | `src/app/(internal)/leads/*`, `src/modules/participants/*` |
| Verfügbarkeitsprüfung (20h/6M Gate) | ✓ | `src/modules/participants/eligibility-gates.ts`, `src/app/t/[token]/page.tsx` |
| Aufgabenverwaltung (open, in_progress, waiting, done, escalated, cancelled) | ✓ | `src/modules/tasks/*` |
| Routing-Engine: Automatische Aufgabenerzeugung auf Status-Wechsel | ✓ | `src/modules/routing/engine.ts`, `src/db/schema/tasks.ts` |
| Magic Links: Sicherungstoken für externe (Login-freie) Aufgabenseiten | ✓ | `src/modules/tokens/*`, `src/db/schema/magic-link-tokens.ts` |
| Document Checklist & Generate (PDF) | ✓ | `src/modules/documents/*` |
| Canvas-basierte Signaturen (einfache elektronische Signaturen) | ✓ | `src/modules/signatures/*`, `src/db/schema/signatures.ts` |
| Mehrfach-Signer mit parallel signatures + Finalisierung | ✓ | `src/modules/signatures/progress.ts`, `src/modules/signatures/finalize.ts` |
| Application status tracking (in_preparation → complete → submitted → response_pending → approved/rejected) | ✓ | `src/modules/applications/*`, `src/db/schema/applications.ts` |
| Arbeitgeber-Setup-Assistent (Betriebsnummer, AGS, Zeitmodelle) | ✓ | `src/app/(internal)/employers/*`, `src/modules/employers/*` |
| Outbound Message Queue (Postausgang) mit Genehmigungspflicht | ✓ | `src/app/(internal)/outbox/*`, `src/modules/messaging/*`, `src/db/schema/outbound-messages.ts` |
| WhatsApp-Integration (Meta Cloud API, Templates, Webhooks) | ✓ | `src/modules/messaging/adapters.ts`, `src/modules/messaging/whatsapp-webhook.ts` |
| Email-Integration (Resend) | ✓ | `src/modules/messaging/adapters.ts` |
| Import Runs (Handelsregister-Import, Dedup, Provenance) | ✓ | `src/modules/register/*`, `src/db/schema/import-runs.ts` |
| Activity Log (Audit Trail) | ✓ | `src/db/schema/activity-log.ts`, `src/modules/audit/log.ts` |
| Role-based Access Control (consultant, admin) | ✓ | `src/db/schema/users.ts`, `src/modules/auth/session.ts` |
| Session-Management (JWT, 12-hour TTL, HttpOnly cookies) | ✓ | `src/modules/auth/session.ts` |
| Database-level RLS (Row-Level Security) | ✓ | `drizzle/0001_rls_policies.sql` |
| Analytics Dashboard (§17 KPIs, Funnel) | ✓ | `src/app/(internal)/reports/*`, `src/modules/reports/metrics.ts` |
| Contact Notes (Notizen zur Verfolgung) | ✓ | `src/db/schema/contact-notes.ts` |

### Konfigurationsabhängig (Configuration-Dependent)

| Feature | Status | Anmerkung |
|---------|--------|----------|
| WhatsApp Live-Versand | Config | Benötigt `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` (ansonsten Mock) |
| E-Mail Live-Versand | Config | Benötigt `RESEND_API_KEY`, `RESEND_FROM_EMAIL` (ansonsten Mock) |
| Aptitude Test Launch | Config | `APTITUDE_TEST_BASE_URL` für externen Provider |
| Import von Eignungstestergebnissen | Config | Noch nicht automatisiert – manuelle Eingabe erforderlich |

### Geplant (Planned)

| Feature | Status | Anmerkung |
|--------|--------|----------|
| BA eService Upload (Einzelantrag & Sammelantrag) | Planned | AcroForm-Feldmappings + eService-Konnektoren erforderlich |
| Qualified Electronic Signature (QES) via Skribble/Yousign | Planned | Wrapper-Architektur vorhanden (`src/modules/signatures/provider.ts`); Provider-Integration ausstehend |
| Consent/Privacy-Dialog (DSGVO) | Planned | Consent records strukturiert (`src/db/schema/consent-records.ts`), wording needs legal review |
| Automatisiertes Reminder & Escalation Scheduling | Planned | Infrastruktur vorhanden (`src/db/schema/reminder-jobs.ts`, `src/jobs/`); Scheduler-Integration ausstehend |
| Externe Aufrufschnittstellen (Public API) | Planned | Ausstehend |
| Record-Ownership-basierte Access Control für Consultants | Planned | **Known Limitation**: Aktuell nicht implementiert – Consultants sehen alle tenant-weiten Daten |

---

## Glossar und Datenmodell

### Primäre Entitäten

#### **Tenant (Mandant)**
- **Definition**: Logische Organisationsgrenze (z.B. eine Agentur oder Gesellschaft)
- **Enforcement**: Alle Tabellen haben `tenant_id`; Postgres RLS erzwingt tenant-Isolation auf DB-Ebene
- **Referenz**: `src/db/schema/tenants.ts`, `drizzle/0001_rls_policies.sql`

#### **Participant (Teilnehmer:in / Lead)**
- **Definition**: Ein Arbeitnehmer, der in Frage kommt für oder bereits eingeschrieben ist in eine Maßnahme
- **Status-Pipeline**: `new` → `called` → `interested` / `not_interested` / `eligibility_unclear` / `employer_pending` → `qualified` → `test_phase` / `documents_phase` / `application_phase` → `enrolled` / `lost`
- **Kernfelder**: 
  - Personendaten (`firstName`, `lastName`, `email`, `phone`, `dateOfBirth`, Adresse)
  - Erwerbsstatus (`employmentStatus`: employed, self_employed, unemployed, other)
  - **Verfügbarkeitsprüfung** (`availabilityStatus`: yes, probably_employer_pending, partial, not_possible, unclear) – **kritisches Gating-Feld**
  - Finanzielle Herkunftsdaten (für Register-Importe: `netIncome`, `financialYear`, `financialsSource`)
  - BA-Daten (Epic A) (`svNumber`, `iban`, `bic`, `monthlyGrossSalary`, `salaryComponents`, `schulungszeiten`, `qualificationHistory`, etc.)
  - Zuordnung: `assignedConsultantId`, `employerId`, `measureId`
  - Herkunft: `source` (manual / openregister), `registerId` (dedup key), `importRunId`
- **Referenz**: `src/db/schema/participants.ts`, lines 32–150

#### **Employer (Arbeitgeber)**
- **Definition**: Ein registriertes Unternehmen, das Mitarbeitende an einer Maßnahme anmeldet
- **Status-Pipeline**: `new` → `invited` → `setup_in_progress` → `betriebsnummer_missing` / `ags_unclear` / `time_model_pending` → `confirmed` / `declined`
- **Kernfelder**:
  - Unternehmensdaten (`companyName`, Adresse, `industry`, `employeeCount`)
  - Ansprechperson (`contactName`, `contactRole`, `contactEmail`, `contactPhone`)
  - **Betriebsnummer** (`betriebsnummer`) – **Pflichtfeld für Antrag**
  - Agenturservice-Status (`responsibleAgency`, `agsRegistered`, `agsContactName`, `agsContactEmail`, `agsContactPhone`)
  - Setup-Bestätigungen (`trainingSupportConfirmed`, `timeModelStatus`)
  - BA-Daten (Epic A) (`legalForm`, `iban`, `bic`, `staffingByHoursBand`, `salaryComponents`, `hasBetriebsvereinbarung`)
  - Herkunft: `source`, `registerId`, `registerNumber`, `registerType`, `registerCourt`
- **Referenz**: `src/db/schema/employers.ts`, lines 16–84

#### **Task (Aufgabe)**
- **Definition**: Eine Arbeitseinheit, die eine Person oder ein System bearbeiten muss
- **Status**: `open` → `in_progress` → `waiting` → `done` / `escalated` / `cancelled`
- **Besitzer** (Polymorphic Owner):
  - `ownerKind`: internal_user, participant, employer
  - `ownerUserId`, `ownerParticipantId`, `ownerEmployerId` (exact one set per CHECK constraint)
- **Kanal** (`channel`): internal (nur konsultant sichtbar), email, whatsapp, magic_link
- **Kontext** (Polymorphic Subject):
  - `subjectKind`: participant, employer, appointment, aptitude_test, task, document, signature, application
  - `subjectId`: Verweis auf die konkrete Entity
- **Eskalation**: `dueAt`, `escalationAt`, `escalatedToUserId`
- **Routing**: `routingRuleId`, `type` (frei definierbar: "collect_contact", "confirm_availability", etc.)
- **Referenz**: `src/db/schema/tasks.ts`, lines 12–64

#### **Application (Antrag)**
- **Definition**: Eine formal eingereichte Anmeldung einer Teilnehmerin zu einer Maßnahme bei einer Arbeitsagentur
- **Status**: `in_preparation` → `complete` → `sent_to_employer` → `submitted` → `response_pending` → `approved` / `rejected` / `correction_required`
- **Beziehungen**: `participantId`, `employerId`, `measureId`
- **Typen** (`applicantType`): single (Einzelantrag, 6 Schritte) | company (Sammelantrag, 7 Schritte mit Listen-Upload)
- **Metadaten**: `submittedAt`, `responseAt`, `responseNote`
- **Referenz**: `src/db/schema/applications.ts`, lines 8–26

#### **Document (Unterlage)**
- **Definition**: Ein generiertes oder hochgeladenes Dokument (PDF, Formular, Nachweis)
- **Status**: `data_missing` → `prefilled` → `reviewed` → `approved` → `sent` → `submitted` → `partially_signed` → `signed`
- **Typen**: Verschiedene Dokument-Templates definiert in `templates/pdf` und `templates/documents`
- **Inhalt**: `templateKey`, `filePath` (SHA-256), `signedFilePath` (nach Signatur), `signedSha256`
- **Zuordnung**: Optional `participantId`, `employerId`, `applicationId`
- **Referenz**: `src/db/schema/documents.ts`, lines 8–32

#### **Signature (Unterschrift)**
- **Definition**: Eine Audit-trail-Signatur auf einem Dokument (einfache elektronische Signatur oder später QES)
- **Status**: `pending` → `signed` / `declined` / `expired`
- **Unterzeichner** (Polymorphic):
  - `signerKind`: internal_user, participant, employer
  - `signerUserId`, `signerParticipantId`, `signerEmployerId`
- **Audit**: `signerName`, `signedAt`, `ipAddress`, `documentSha256`, `provider` (canvas, später skribble/yousign)
- **Artefakt**: `signatureImagePath`
- **Referenz**: `src/db/schema/signatures.ts`, lines 11–36

#### **Magic Link Token (Aufgaben-Link)**
- **Definition**: Ein kryptographisches Token, das Participant/Employer/Backoffice Zugang zu einer Aufgabe ohne Login gewährt
- **Lifecycle**: issued → used → revoked (single-use, time-limited)
- **Speicherung**: Nur SHA-256-Hash (DB-Leak schützen)
- **Feld**: `scope` (z.B. "availability_check", "contact_correction", "employer_setup", "sign_document")
- **Referenz**: `src/db/schema/magic-link-tokens.ts`, lines 16–37

#### **Outbound Message (Ausgehende Nachricht)**
- **Definition**: Eine zur Genehmigung anstehende Nachricht (WhatsApp, E-Mail, oder System-Notiz)
- **Lebenszykl**: `pending_approval` → (`approved` → `sending` → `sent` → `delivered` / `failed`) | `rejected` / `cancelled`
- **Genehmigung**: Human-in-the-loop vor Versand; `approvedByUserId`, `approvedAt`, `rejectionReason`
- **Inhalt**: `templateKey`, `subject` (E-Mail), `body`, `variables` (JSON für Interpolation)
- **Empfänger**: `recipientKind`, `recipientId`, `recipientPhone` / `recipientEmail`
- **Provider**: `providerMessageId` (nach erfolg. Versand), `errorDetail` (bei Fehler)
- **Referenz**: `src/db/schema/outbound-messages.ts`, lines 26–70

#### **Appointment (Termin)**
- **Definition**: Ein geplanter Termin zwischen Consultant und Participant
- **Typen** (`appointmentType`): follow_up, aptitude_test, consultation
- **Status**: `scheduled` → `reminder_sent` → `no_show` / `completed` / `rescheduled` / `cancelled`
- **Felder**: `participantId`, `consultantId`, `scheduledAt`, `notes`
- **Referenz**: `src/db/schema/appointments.ts`, lines 7–20

#### **Import Run (Importlauf)**
- **Definition**: Ein Batch-Import von Leads oder Arbeitgebern (z.B. vom Handelsregister)
- **Lebenszykl**: `running` → `completed` / `failed`
- **Provenance**: `source` (z.B. "openregister"), `criteria` (Suchparameter), `stats` (Zähler: inserted/updated/skipped)
- **Audit**: `startedByUserId`, `startedAt`, `finishedAt`, `error`
- **Referenz**: `src/db/schema/import-runs.ts`, lines 8–25

#### **Activity Log (Audit-Protokoll)**
- **Definition**: Append-only Event Stream aller Status-Übergänge
- **Einträge**: `actorKind` (system / internal_user / participant / employer), `subjectKind`, `event` (z.B. "status_changed", "task_completed", "token_used", "consent_granted"), `meta` (JSON, PII-minimal)
- **Zweck**: Compliance, Debugging, Rules-Engine-Trigger
- **Referenz**: `src/db/schema/activity-log.ts`, lines 8–25

#### **Measure (Maßnahme)**
- **Definition**: Eine AZAV-zertifizierte Weiterbildungsmaßnahme
- **Felder**: `name`, `azavNumber`, `durationWeeks`, `weeklyHours` (default 20), `format` (full_time / part_time / online / hybrid), `costEur`, `startDate`, `targetGroup`, `objective`
- **Referenz**: `src/db/schema/measures.ts`, lines 6–20

#### **User (Internal User)**
- **Definition**: Ein interner Benutzer (Verkaufsberater oder Admin)
- **Nur Login-Benutzer**, nicht Participant/Employer
- **Felder**: `id`, `tenantId`, `email`, `name`, `role` (consultant / admin), `passwordHash`, `active`
- **Referenz**: `src/db/schema/users.ts`, lines 7–21

---

## Multi-Mandantschaft und Dateneigentum

### Isolation Mechanism

**Ansatz**: Row-Level Security (RLS) auf PostgreSQL-Ebene  
**Scope**: Alle Tabellen außer `tenants` selbst sind mit `tenantId` versehen

```sql
-- Beispiel aus drizzle/0001_rls_policies.sql
CREATE POLICY rls_tenant_policy
  ON participants
  FOR ALL
  TO app_user
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
```

**Erzwingung**: 
- Beim Login wird `app.tenant_id` aus der Session (`tenantId`) gesetzt (siehe `src/modules/auth/session.ts`, line 32)
- Alle Queries laufen über den `app` role (restricted), nicht `postgres` (siehe `src/db/client.ts`)
- Migrations laufen über `MIGRATION_DATABASE_URL` (owner role), nicht auf production data

**Dateneigentum**: 
- Jeder Tenant sieht nur seine eigenen Participants, Applications, Tasks, etc.
- Dedup-Constraints berücksichtigen tenant-Isolation (z.B. `uniqueIndex("participants_tenant_register_idx")` in `src/db/schema/participants.ts`, line 137–139)

---

## Rollen und Berechtigungen

### Unterscheidung: Authentication vs. Authorization

Die Plattform unterscheidet strikt zwischen:

1. **Authentication (Authentifizierung)**: "Wer bist du?" 
   - Intern: `getSession()` validiert JWT-Cookie (siehe `src/modules/auth/session.ts`, lines 46–72)
   - Extern: `validateToken()` prüft Magic-Link-Token (Hash-basiert, single-use, expiry, revocation)

2. **Authorization (Autorisierung)**: "Was darfst du tun?" auf mehreren Ebenen
   - **Role-based**: `role: "admin"` | `"consultant"` in JWT/Token
   - **Tenant-scoped**: Postgres RLS erzwingt `tenant_id` Filter
   - **Record-ownership (LIMITATION)**: Siehe Hinweise unten – **nicht vollständig implementiert**
   - **Server-action gating**: Explizite Rollen-Checks (z.B. `getAdminSession()`)

### Bekannte Autorisierungs-Lücken (vor Produktionsstart zu schließen)

**Die folgenden Beschränkungen sind bekannt und sollten als Operational Constraints verstanden werden:**

1. **Consultant → Lead-Ownership**: Die Spalte `participants.assigned_consultant_id` existiert, wird aber **nicht auf DB-Ebene durchgesetzt**
   - Consultant A könnte theoretisch Leads von Consultant B via API sehen/bearbeiten
   - RLS schützt nur Tenant-Isolation, nicht Consultant-Isolation
   - UI-Filter (`consultant=<id>` param) ist **kein Sicherheitsmechanismus**
   - **Status**: Known limitation vor Produktionsstart zu beheben

2. **Admin vs. Consultant Datensichtbarkeit**: Beide sehen identische Tenant-Daten via RLS
   - Der Unterschied ist nur "Admin can start imports" (`getAdminSession()` check)
   - Berichte sind Tenant-weit, nicht System-weit
   - **Status**: Design intent vs. implementation mismatch

3. **Task-Ownership**: Ähnlich – keine DB-Level Durchsetzung für Consultants
   - RLS schützt nur Tenant-Isolation
   - **Status**: Known limitation

**Recommendation**: Diese Limits durch explizite App-Level Ownership-Checks oder erweiterte RLS-Policies schließen.

---

### Rolle: **Admin (Administrator)**

**Zweck**: Systemverwaltung, Setup, Import-Verwaltung  
**Authentication**: ✓ Session `role: "admin"` (siehe `src/modules/auth/session.ts`, lines 85–89)  
**Authorization**: ✓ TEILWEISE – Nur `getAdminSession()` Check auf Admin-Actions

| Funktion | Auth | Authorization | Bemerkung |
|----------|------|----------|----------|
| Admin-Login | Email + Password | role = "admin" in JWT | `src/modules/auth/actions.ts`, line 39–80 |
| Handelsregister-Import | Authenticated | `getAdminSession()` required | Expliziter Role-Check in Server Action |
| Audit-Log ansehen | Authenticated | Tenant RLS only | **Limitation**: No admin-specific filter – sees all tenant events |
| Berichte ansehen | Authenticated | Tenant RLS only | **Limitation**: Reports sind Tenant-weit, nicht system-wide |
| Outbound Messages genehmigen/ablehnen | Authenticated | Tenant RLS only | **Limitation**: No distinct admin approval queue |
| Lead/Arbeitgeber erfassen | Authenticated | Tenant RLS only | No admin-specific restrictions |
| Benutzer erstellen/bearbeiten | (Planned) | (Planned) | Noch nicht implementiert |

**Server-Action Protection**: `getAdminSession()` in `src/modules/auth/session.ts`, line 85–89 – muss explizit von Admin-Actions aufgerufen werden (keine automatische Durchsetzung).

---

### Rolle: **Consultant (Verkaufsberater:in)**

**Zweck**: Lead-Vertrieb, -Betreuung, Aufgabenverwaltung, Messaging-Genehmigung  
**Authentication**: ✓ Session `role: "consultant"` (siehe `src/modules/auth/session.ts`, lines 46–72)  
**Authorization**: ✓ TEILWEISE – Nur Tenant RLS, keine Record-Ownership-Filterung

| Funktion | Auth | Authorization | Bemerkung |
|----------|------|----------|----------|
| Authentifizierung (Login) | Email + Password | role = "consultant" | `src/modules/auth/session.ts` |
| Tenant-Leads ansehen | Authenticated | Tenant RLS enforced | **Limitation**: UI may filter by `consultant=<id>` but no DB enforcement |
| Lead erstellen/bearbeiten | Authenticated | Tenant RLS enforced | `assigned_consultant_id` optional – no read-only filter |
| Participant-Status ändern | Authenticated | Tenant RLS enforced | No ownership validation |
| Kontaktnoten hinzufügen | Authenticated | Tenant RLS enforced | Visible to all tenant users |
| Tasks ansehen/bearbeiten | Authenticated | Tenant RLS enforced | No consultant-specific DB filter |
| Magic Links generieren/widerrufen | Authenticated | Tenant RLS enforced | No ownership validation |
| Dokumente hochladen/generieren | Authenticated | Tenant RLS enforced | No record-ownership check |
| Signaturen unterschreiben | Authenticated | Tenant RLS enforced | Where `signerKind: "internal_user"` |
| Applications verwalten | Authenticated | Tenant RLS enforced | Status-Übergänge; no ownership check |
| Outbound Messages genehmigen/ablehnen | Authenticated | Tenant RLS enforced | No distinct role in queue |
| Berichte ansehen | Authenticated | Tenant RLS enforced | Identical to admin access |
| Undo (Strg+Z) | Authenticated | Tenant RLS enforced | **Geplant** – not yet implemented |

**Important**: Jeder Consultant sieht **alle Leads, Tasks, Documents** in seinem Tenant. Die `assigned_consultant_id`-Spalte dient der **Workflow-Verwaltung**, nicht der **Zugriffskontrolle**.

---

### Rolle: **Operations / Backoffice** (Geplant)

**Status**: Betrieblich definiert, nicht technisch durchgesetzt  
**Authentication**: Nutzt Consultant-Rolle  
**Authorization**: Keine separaten Checks – Consultant-Rolle mit Workflows

Funktionen: Documents, Application-Pakete, Support – alle via Consultant-Rolle.

**Implementierungsnote**: Könnte als eigene `role: "operations"` später hinzugefügt werden. **Noch nicht implementiert.**

---

### Rolle: **Manager / Lead** (Geplant)

**Status**: Betrieblich definiert, nicht technisch durchgesetzt

- Read-only KPI-Zugriff (future)
- Custom reports (future)
- Zukünftig via `role: "manager"`

**Noch nicht implementiert.**

---

### Rolle: **External Participant (Externe Teilnehmer:in)**

**Status**: Login-frei – Magic Links nur  
**Authentication**: Magic-Link-Token-Validierung (Hash-based, single-use)  
**Authorization**: Token-Scope-basiert

| Funktion | Medium | Scope Authorization |
|----------|--------|---------|
| Verfügbarkeit bestätigen | Magic Link + Form | `scope: "availability_check"` |
| Kontaktdaten korrigieren | Magic Link + Form | `scope: "contact_correction"` |
| Anhang hochladen | Magic Link + File-Upload | `scope: "document_upload"` |
| Dokument unterschreiben | Canvas-Signatur | `scope: "sign_document"` |
| Termine verschieben | Magic Link + Form | `scope: "reschedule_appointment"` |
| Eignungstests starten | Magic Link → Redirect | `scope: "start_aptitude_test"` |
| Aufgaben ansehen | Magic Link Page | Task context via RLS |

**Technische Enforcement**:
- `src/app/t/[token]/page.tsx`: Magic-Link-basierte Seiten ohne Session
- `src/modules/tokens/service.ts`: Token-Validierung + single-use enforcement
- `src/db/schema/magic-link-tokens.ts`: Hash-Storage (nie plain text)
- RLS: Participant sieht nur Task-relevante Daten via Token-Gate

**Sicherheit**: Single-use, expiry, revocation, Hash-only storage

---

### Rolle: **External Employer (Externer Arbeitgeber)**

**Status**: Login-frei – Magic Links nur  
**Authentication**: Magic-Link-Token-Validierung  
**Authorization**: Token-Scope-basiert

| Funktion | Medium | Scope |
|----------|--------|---------|
| Betriebsnummer bestätigen | Magic Link + Form | `scope: "employer_setup"` |
| Arbeitgeberservice-Setup | Magic Link + Questionnaire | `scope: "employer_setup"` |
| Kontaktperson registrieren | Magic Link + Form | `scope: "employer_setup"` |
| Zeitmodelle definieren | Magic Link + Form | `scope: "employer_setup"` |
| Antragsbestätigung unterschreiben | Magic Link + Signature | `scope: "sign_application"` |

**Technische Enforcement**: Wie External Participant – Magic Links, Token-Hashes, RLS

---

### Zusammenfassung: Authentifizierung vs. Autorisierung

| Rolle | Authentication | Authorization | DB Enforcement | Limitations |
|-------|--------|---------|--------|--------|
| **Admin** | Email+Password | `getAdminSession()` check | Tenant RLS | No admin-specific data scope; only role-check on import |
| **Consultant** | Email+Password | `getSession()` check | Tenant RLS | **No record-ownership filtering** – sees all tenant data |
| **Operations** | (Consultant) | (Workflows) | Tenant RLS | Not enforced; future role |
| **Manager** | (Future) | (Future) | Tenant RLS | Not implemented |
| **External Participant** | Magic Link | Token scope + single-use | Task+RLS | Scoped to single task |
| **External Employer** | Magic Link | Token scope + single-use | Task+RLS | Scoped to single task |

**Key Insight**: 
- Authentication ist gut implementiert
- Tenant-level Authorization ist gut implementiert
- **Record-Ownership-basierte Authorization ist eine bekannte Lücke** vor Produktionsstart zu beheben

---

## Navigation und Seiten-Atlas

### Authentifizierte Seiten (Nur für Internal Users: Consultant + Admin)

#### **1. `/auth/sign-in` (Anmeldung)**

**Route**: `src/app/auth/sign-in/page.tsx`  
**Zugriff**: Öffentlich (keine Auth erforderlich)  
**Purpose**: Email + Password Login für Consultants und Admins

**Sicherheit**:
- Rate limiting: 10 failed attempts per 5 minutes per IP
- Passwort-Vergleich: bcryptjs `compare()`
- Session-Erstellung: JWT HS256, 12-hour TTL, HttpOnly cookie

---

#### **2. `/pipeline` (Lead-Pipeline / Funnel)**

**Route**: `src/app/(internal)/pipeline/page.tsx`  
**Zugriff**: Authenticated  
**Purpose**: Gesamt-Pipeline-Übersicht mit Filters, Aggregation, Funnels

**Query-basierte Filter** (User-provided):
- `consultant=<user_id>` → UI-Level Filter (kein DB-Security)
- `status=<status>` → Status-Filter
- `source=<source>` → Herkunftsfilter

**Primary Actions**:
- "Neuer Lead" → `/leads/new`
- Click row → `/leads/[id]`
- "Archivieren" → status → `lost`

**Permission Note (Corrected)**: 
- **Actual**: Both Consultant und Admin sehen alle tenant-Leads via RLS. Kein DB-Ownership-Filter.
- **UI-Filter**: Query-Param `consultant=<id>` filtert auf Applikationsebene, nicht auf DB.
- **Known Limitation**: RLS schützt nur Tenant-Isolation. Record-Ownership nicht durchgesetzt. Vor Produktionsstart zu beheben.

---

#### **3. `/leads/new` (Neuer Lead)**

**Route**: `src/app/(internal)/leads/new/page.tsx`  
**Zugriff**: Authenticated  
**Purpose**: Manuelle Lead-Erfassung

**Primäre Action**: Form Submission → `createParticipant()` → new participant row mit `status: "new"`

---

#### **4. `/leads/[id]` (Lead-Detail-View)**

**Route**: `src/app/(internal)/leads/[id]/page.tsx`  
**Zugriff**: Authenticated (Tenant RLS)  
**Purpose**: Vollständiges Lead-Profil, Status-Übergänge, Notizen, Entities

**Primäre Actions**:
- Status ändern → Routing-Engine runs, tasks created
- Notiz hinzufügen → contact_notes row
- Lead-Link generieren → magic-link token
- Dokument generieren → PDF
- Signatur-Link generieren → signature task

---

#### **5. `/leads/import` (Handelsregister-Import)**

**Route**: `src/app/(internal)/leads/import/page.tsx`  
**Zugriff**: Admin only (`getAdminSession()` required in actions)  
**Purpose**: Massen-Import von Leads/Arbeitgebern

**Authorization**: Server actions prüfen `getAdminSession()` explizit

---

#### **6. `/tasks` (Aufgabenverwaltung)**

**Route**: `src/app/(internal)/tasks/page.tsx`  
**Zugriff**: Authenticated  
**Purpose**: Open tasks list (tenant-wide)

**Primary Actions**:
- Mark Complete → `completeTask()`
- Generate Magic Link → `issueLinkForTask()`
- Revoke Link → `revokeTaskLink()`
- WhatsApp Send → Click to Chat

**Permission Note (Corrected)**:
- **Actual**: Both roles see tenant-wide tasks via RLS
- **No DB ownership enforcement** for Consultant tasks
- **Known Limitation**: Record-ownership not enforced

---

#### **7. `/outbox` (Postausgang – Messaging Approval)**

**Route**: `src/app/(internal)/outbox/page.tsx`  
**Zugriff**: Authenticated  
**Purpose**: Human-in-the-loop approval gate for all outbound messages

**Primary Actions**:
- Approve → dispatch to provider, create message_deliveries
- Reject → reject message
- Preview → view rendered content

**Permission Note (Corrected)**:
- **Actual**: Both Consultant und Admin see same queue via Tenant RLS
- **No distinct approval scope** between roles
- **Known Limitation**: Both roles have identical approval capabilities

---

#### **8. `/appointments` (Terminverwaltung)**

**Route**: `src/app/(internal)/appointments/page.tsx`  
**Zugriff**: Authenticated  
**Purpose**: Appointment scheduling + tracking

**Primary Actions**:
- New Appointment → creates appointments row
- Reschedule → updates scheduledAt
- Mark Complete/No-Show → status updates

---

#### **9. `/employers` (Arbeitgeber-Verwaltung)**

**Route**: `src/app/(internal)/employers/page.tsx`  
**Zugriff**: Authenticated  
**Purpose**: Employer overview + setup tracking

**Primary Actions**:
- New Employer → creates employers row
- Edit → updates employer fields
- Generate Setup Link → magic-link for employer setup task

---

#### **10. `/documents` (Dokumente & Checkliste)**

**Route**: `src/app/(internal)/documents/page.tsx` + `[participantId]/page.tsx`  
**Zugriff**: Authenticated  
**Purpose**: Document generation, upload, signature collection

**Primary Actions**:
- Generate Document → renders template, saves PDF
- Upload → saves file, creates documents row
- Request Signatures → creates signature tasks
- Export Package → ZIP with all docs

---

#### **11. `/applications` (Anträge)**

**Route**: `src/app/(internal)/applications/page.tsx`  
**Zugriff**: Authenticated  
**Purpose**: Application lifecycle tracking

**Primary Actions**:
- New Application → status `in_preparation`
- Check Readiness → compute blockers
- Mark Complete → status `complete`
- Export Package → ZIP
- Record Response → status updated

---

#### **12. `/reports` (Berichte & Analytics)**

**Route**: `src/app/(internal)/reports/page.tsx`  
**Zugriff**: Authenticated  
**Purpose**: Dashboard with §17 KPIs, funnel analysis

**KPIs computed**:
- Contact Rate, No-Show Rate, Aptitude Rate, Employer Approval, Submission Rate

**Permission Note (Corrected)**:
- **Actual**: Both roles see identical Tenant KPIs via RLS
- **No admin-specific system-wide reporting**
- **Known Limitation**: Reports sind Tenant-weit, nicht system-wide

---

### Magic-Link Pages (External, No Login)

#### **13. `/t/[token]` (Allgemeine Aufgabenseite)**

**Route**: `src/app/t/[token]/page.tsx`  
**Zugriff**: Magic-Link-Token-basiert  
**Purpose**: Universal task landing page (Participant/Employer)

**Security**:
- Token-Validierung: Hash-based, single-use, expiry, revocation
- Conditional rendering je nach `scope` (z.B. "availability_check", "contact_correction", "employer_setup")

---

## Benutzerfachdatenmodell

### Entitäten & Beziehungen (Plain German)

```
Tenant
├─ Participant (Lead)
│  ├─ Employer
│  ├─ Measure
│  ├─ User (Consultant assigned)
│  ├─ Task (owner: participant)
│  ├─ Application
│  │  └─ Document (type: application_package)
│  └─ Appointment
├─ Task (owner: internal_user or employer)
├─ OutboundMessage (queue for approval)
├─ Document (participant/employer/application scoped)
│  └─ Signature (multi-signer)
└─ ActivityLog (all events)
```

### Status-Pipelines (Teilnehmende)

```
new → called → interested/not_interested/eligibility_unclear/employer_pending
    → qualified → test_phase/documents_phase/application_phase 
    → enrolled / lost
```

**Gating**: Availability check, Eligibility gates, Documentation requirements

---

## Für Sie: Der schnelle Einstieg pro Rolle

### 🔑 Sie sind **Admin**?

**Start-Schritte**:
1. Anmelden unter `/auth/sign-in`
2. Navigation → **"Berichte"** (`/reports`) – System-Überblick
3. **"Pipeline"** (`/pipeline`) – Alle Leads
4. Bei Bedarf: **"Leads importieren"** (`/leads/import`) – Handelsregister-Import

**Key URLs**: `/reports`, `/pipeline`, `/leads/import`

---

### 💼 Sie sind **Consultant (Verkaufsberater:in)**?

**Start-Schritte**:
1. Anmelden unter `/auth/sign-in`
2. **"Pipeline"** (`/pipeline`) – Leads-Übersicht + Filter
3. **"Neuer Lead"** (`/leads/new`) – Lead erfassen
4. Lead bearbeiten: Click → `/leads/[id]`
   - Status ändern
   - Notizen hinzufügen
   - Magic Links generieren
5. **"Aufgaben"** (`/tasks`) – Offene tasks
6. **"Postausgang"** (`/outbox`) – Nachrichten genehmigen
7. **"Dokumente"** (`/documents`) – Unterlagen + Signaturen
8. **"Anträge"** (`/applications`) – Application tracking

**Key URLs**: `/pipeline`, `/leads/new`, `/leads/[id]`, `/tasks`, `/outbox`, `/documents`, `/applications`

---

### 👤 Sie sind **Participant** oder **Employer**?

**Sie brauchen keinen Login!** Sie erhalten **Magic Links** per E-Mail oder WhatsApp.

**Start-Schritte**:
1. Magic Link in E-Mail oder WhatsApp klicken
2. Aufgabe ausfüllen (Verfügbarkeit, Kontakt, Arbeitgeber-Setup, Unterschrift)
3. Fertig → Automatische nächste Schritte

**No Login Required** – Einfach Link öffnen und Formular füllen.

---

## Anhang: Wichtige Enums und Konstanten

### Participant Status Enum
```
new, called, not_reachable, wrong_number, interested, 
not_interested, eligibility_unclear, employer_pending, 
qualified, test_phase, documents_phase, application_phase, 
enrolled, lost
```

### Task Status Enum
```
open, in_progress, waiting, done, escalated, cancelled
```

### User Role Enum
```
consultant, admin
```

### Owner Kind Enum (Polymorphic)
```
internal_user, participant, employer
```

### Channel Enum
```
internal, email, whatsapp, magic_link
```

### Outbound Message Status Enum
```
pending_approval, approved, sending, sent, delivered, 
failed, rejected, cancelled
```

---

## Referenzen und Links

| Bereich | Datei | Zeilen |
|---------|-------|--------|
| Schema: Participants | `src/db/schema/participants.ts` | 32–150 |
| Schema: Employers | `src/db/schema/employers.ts` | 16–84 |
| Schema: Users | `src/db/schema/users.ts` | 7–21 |
| Schema: Tasks | `src/db/schema/tasks.ts` | 12–64 |
| Schema: Applications | `src/db/schema/applications.ts` | 8–26 |
| Schema: Documents | `src/db/schema/documents.ts` | 8–32 |
| Schema: Signatures | `src/db/schema/signatures.ts` | 11–36 |
| Schema: Magic Links | `src/db/schema/magic-link-tokens.ts` | 16–37 |
| Schema: Outbound Messages | `src/db/schema/outbound-messages.ts` | 26–70 |
| Schema: Activity Log | `src/db/schema/activity-log.ts` | 8–25 |
| Schema: Enums | `src/db/schema/enums.ts` | 1–184 |
| Auth Session | `src/modules/auth/session.ts` | 1–90 |
| Auth Actions (Login) | `src/modules/auth/actions.ts` | 1–87 |
| RLS Policies | `drizzle/0001_rls_policies.sql` | All |
| Pipeline Page | `src/app/(internal)/pipeline/page.tsx` | 1–603 |
| Tasks Page | `src/app/(internal)/tasks/page.tsx` | 1–193 |
| Outbox Page | `src/app/(internal)/outbox/page.tsx` | All |
| Documents Page | `src/app/(internal)/documents/[participantId]/page.tsx` | All |
| Applications Page | `src/app/(internal)/applications/page.tsx` | All |
| Reports Page | `src/app/(internal)/reports/page.tsx` | All |
| Magic Link Task Page | `src/app/t/[token]/page.tsx` | All |
| Translations (German) | `messages/de.json` | All |

---

**Dokument Version**: 1.1  
**Erstellt**: 28. Juli 2026  
**Korrektionen**: Access-Model-Validierung, Authentifizierung vs. Autorisierung  
**Autor**: System Documentation  
**Sprache**: Deutsch  
**Zielgruppe**: Benutzer (Consultant, Admin, Participant, Employer)
