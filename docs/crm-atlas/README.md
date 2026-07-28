# CRM-Atlas: Wiki & Bedienungsanleitung für Benutzer

**Zuletzt aktualisiert:** 28. Juli 2026  
**Status:** Benutzer-Wiki (Betrieblich)  
**Sprache:** Deutsch (Bedienung), Code englisch (Technik)  
**Zielgruppe:** Berater:innen, Administratoren, Operationen, Support, Schulung

> **In-App Hilfe (Produkt):** `/hilfe` — kuratierte, rollenbasierte Abläufe für den Alltag.  
> **Interaktives HTML-Wiki (Engineering/Training):** [`../crm-wiki.html`](../crm-wiki.html)  
> Enthält User Stories, E2E-Workflows, Seitenspecs und den Bedienungs-Atlas — mit Volltextsuche.  
> Offline öffnen oder lokal serven (`python3 -m http.server` in `docs/`).  
> Neu bauen: `node scripts/build-crm-wiki.mjs`

---

## Inhaltsverzeichnis

1. [Wiki-Kapitel](#wiki-kapitel)
2. [Schnelleinstieg nach Rolle](#schnelleinstieg-nach-rolle)
3. [Status-Legende](#status-legende)
4. [Kritische Sicherheits-Hinweise](#kritische-sicherheits-hinweise)
5. [Schnell-Workflow-Index](#schnell-workflow-index)
6. [Dokumentations-Konventionen](#dokumentations-konventionen)

---

## Wiki-Kapitel

| Kapitel | Datei | Zielgruppe | Nutzungsfall |
|---------|-------|-----------|-------------|
| **1: Grundlagen & Navigation** | `01-grundlagen-und-navigation.md` | Alle | Systemüberblick, Rollen, Authentifizierung, Seiten-Navigation |
| **2: Leads, Pipeline & Aufgaben** | `02-leads-pipeline-und-aufgaben.md` | Berater:innen, Ops | Lead-Lebenszyklus, Statusübergänge, Aufgaben-Workflow, Routen |
| **3: Kommunikation, Dokumente & Anträge** | `03-kommunikation-dokumente-und-antraege.md` | Operationen, Support | WhatsApp/E-Mail-Versand, Magic Links, Signaturen, Anträge |
| **4: Betrieb, Playbooks & Support** | `04-betrieb-playbooks-und-support.md` | Admin, Ops, Support | Operationale Checklisten, Diagnose-Queries, Sicherheits-Runbooks |

---

## Schnelleinstieg nach Rolle

### 🔑 Sie sind **Admin (Geschäftsführer/IT-Verantwortlicher)**?

**Start-Schritte:**
1. Lesen Sie [Kapitel 1: Grundlagen](./01-grundlagen-und-navigation.md#rolle-admin-administrator) — Rollen & Auth-Modell
2. Prüfen Sie [Kapitel 4: Betrieb](./04-betrieb-playbooks-und-support.md) — Provisioning, Secrets-Rotation, Health-Checks
3. Starten Sie mit: `/reports` (Überblick) → `/leads/import` (Register-Import) → `/pipeline` (Alle Leads)

**Schlüssel-URLs:** `/reports`, `/pipeline`, `/leads/import`  
**Kritischer Link:** [Umgebungsvariablen (Production-Checkliste)](./04-betrieb-playbooks-und-support.md#12-umgebungsvariablen--secrets)

---

### 💼 Sie sind **Berater:in (Sales Consultant)**?

**Start-Schritte:**
1. Lesen Sie [Kapitel 1: Grundlagen](./01-grundlagen-und-navigation.md#rolle-consultant-verkaufsberaterin) — Ihre Rollen & Berechtigungen
2. Sehen Sie sich [Kapitel 2: Lead-Lebenszyklus](./02-leads-pipeline-und-aufgaben.md#1-teilnehmer-lebenszyklus) an — 13 Status verstehen
3. Tägliche Routine: `Pipeline` → Filter nach Status/Datum → Lead öffnen → Task/Status/Notiz aktualisieren
4. Message-Genehmigung: Navigieren Sie zu `Postausgang` → Nachricht prüfen → Genehmigen/Ablehnen
5. Dokumente: `Dokumente` → Teilnehmer:in wählen → Checkliste/Signaturen

**Schlüssel-URLs:** `/pipeline`, `/tasks`, `/outbox`, `/documents`, `/applications`  
**Kritischer Link:** [Tägliche Routine des Consultants](./02-leads-pipeline-und-aufgaben.md#3-tägliche-routine-des-sales-consultants)

---

### 👤 Sie sind **Operationen/Backoffice**?

**Start-Schritte:**
1. Lesen Sie [Kapitel 1: Grundlagen](./01-grundlagen-und-navigation.md#rolle-operations--backoffice-geplant) — Operative Rollen
2. Schwerpunkt: [Kapitel 3: Dokumente & Anträge](./03-kommunikation-dokumente-und-antraege.md#3-dokumente-signaturen-und-anträge) — Document Tracking, Signaturen, Readiness-Gating
3. Tägliche Routine: `Dokumente` (Checkliste prüfen) → `Anträge` (Status) → `Postausgang` (Messages genehmigen)

**Schlüssel-URLs:** `/documents`, `/applications`, `/outbox`  
**Kritischer Link:** [Readiness-Blockers](./03-kommunikation-dokumente-und-antraege.md#readiness-blockers-submission-gating)

---

### 📊 Sie sind **Manager/Führung**?

**Start-Schritte:**
1. Lesen Sie [Kapitel 1: Grundlagen](./01-grundlagen-und-navigation.md#rolle-manager--lead-geplant) — Reports & KPIs
2. Reports-Fokus: [Kapitel 4: Reporting](./04-betrieb-playbooks-und-support.md#21-pipeline-metrics--reporting) — Metriken, Audit-Logs, Import-Qualität
3. Wöchentliche Routine: `/reports` → KPIs prüfen → `/pipeline` (Engpässe identifizieren) → Berater:innen-Meetings

**Schlüssel-URLs:** `/reports`, `/pipeline`  
**Kritischer Link:** [KPIs und Funnel-Metrik](./02-leads-pipeline-und-aufgaben.md#41-kpis-und-funnel-metrik)

---

### 👥 Sie sind **Trainer/Support** (intern oder extern)?

**Start-Schritte:**
1. Kapitel 1 komplett lesen — Alle Rollen & Features
2. Fokus: [Tägliche Routine des Consultants](./02-leads-pipeline-und-aufgaben.md#3-tägliche-routine-des-sales-consultants) — Neue Berater:innen-Schulung
3. Support-Fall? → [Kapitel 4: Troubleshooting-Katalog](./04-betrieb-playbooks-und-support.md#4-safe-troubleshooting-catalog)

**Schlüssel-URLs:** Alle  
**Kritischer Link:** [Onboarding-Curriculum (Tages-Programm)](./04-betrieb-playbooks-und-support.md#61-first-day-program-3-hours)

---

### 👤 Sie sind **Teilnehmer:in oder Arbeitgeber** (extern)?

**Sie brauchen keinen Login!** Sie erhalten **Magic Links** per E-Mail oder WhatsApp.

**Start-Schritte:**
1. Magic Link in E-Mail oder WhatsApp klicken
2. Aufgabe ausfüllen (Verfügbarkeit, Kontakt, Arbeitgeber-Setup, Unterschrift)
3. Fertig → Automatische nächste Schritte

**Kein Passwort erforderlich** — einfach Link öffnen und Formular füllen.

---

## Status-Legende

Alle Funktionen im Atlas sind gekennzeichnet mit einem **Status-Label:**

| Label | Bedeutung | Beispiel |
|-------|-----------|---------|
| ✅ **Implementiert** | Technisch umgesetzt; Einschränkungen werden separat genannt | Lead-Pipeline, Tasks, Postausgang-Freigabe |
| 🟡 **Konfigurationsabhängig** | Benötigt externe Konfiguration oder Anbieterzugang | WhatsApp Cloud API (Meta-Zugangsdaten erforderlich) |
| 🟢 **Geplant / Empfohlen** | Design dokumentiert; noch nicht gebaut | Dark Mode (Phase 2+) |
| 🔴 **Known Blocker** | Blockiert; Workaround nötig | Consultant-Record-Ownership nicht durchgesetzt (UI-Filter statt DB) |
| ⚖️ **Rechtliche Überprüfung ausstehend** | Technisch funktionierend; warte auf Legal | Canvas-Signaturen (eIDAS-SES-Compliance pending) |

---

## Kritische Sicherheits-Hinweise

### ⚠️ Production WhatsApp ist BLOCKIERT bis Atomic CAS Fix

**Status:** Die Message-Approval-Race-Condition (doppelter Versand) ist dokumentiert.

- **Auswirkung:** Ein Berater:in könnte mit Double-Click die gleiche WhatsApp zweimal senden
- **Kein sicherer Workaround:** Die Cloud-API-Freigabe darf bis zum atomaren Server-Fix nicht produktiv aktiviert werden. Eine spätere UI-Deaktivierung wäre nur Defense-in-Depth.
- **Fix-Status:** P1-Blocker; muss vor der Produktionsfreigabe behoben und mit einem Parallelitäts-Test abgesichert werden.
- **Siehe:** `docs/LOGIC-PR-READINESS-REVIEW.md` Section P1-1

### ⚠️ Signaturen & Zertifikate sind Tech-Platzhalter; Rechtsüberprüfung ausstehend

**Status:** Canvas-Signaturen sind technisch implementiert, aber **rechtliche Gültigkeit (eIDAS-SES-Compliance) ist ausstehend**.

- **Was funktioniert:** Unterschrift wird gezeichnet, gehashed, in PDF gestempelt
- **Was noch ausstehend ist:** Behördliche Validierung (BA, Legal, Gericht)
- **Praktisch:** Signierte Dokumente werden mit einem Audit-Zertifikat ("Platzhalter — rechtliche Prüfung ausstehend") versehen
- **Siehe:** [Signatur-Status](./03-kommunikation-dokumente-und-antraege.md#320-signed-artifact-unterschrift-stempel--audit-zertifikat)

### ⚠️ Consultant-Sichtbarkeit ist Tenant-Weit (noch nicht auf Consultant beschränkt)

**Status:** Berater:innen sehen alle Leads im Tenant (nicht nur ihre zugewiesenen).

- **Warum:** Record-Ownership ist bei DB-RLS nicht durchgesetzt
- **Sicherheit:** Tenant-Boundary ist durchgesetzt (RLS); Cross-Tenant-Risiko = niedrig
- **Within-Tenant Risk:** Berater:in A könnte Berater:in B Daten sehen
- **Workaround:** UI-Filter nach `consultant=<id>` ist kein Sicherheitsmechanismus; nur UX
- **Roadmap:** Phase 0 Entscheidung — sollen wir Option B (assigned-only) implementieren?

### ⚠️ Benutzer/Mandanten-Provisioning hat kein UI

**Status:** Keine Application-Seite zum Erstellen von Users/Tenants.

- **Vorhanden:** Nur ein Demo-Seed für lokale/Testdaten; kein Produktions-Provisioning.
- **Production:** Engineering muss zuerst einen geprüften, idempotenten Provisioning-Workflow mit Audit, Fehlerbehandlung und Rollback bereitstellen.

### ⚠️ Direkter DB-Zugriff ist für Operationen NICHT ein Workflow

**Status:** Operationen können **nicht** ad-hoc SQL auf Produktion ausführen.

- **Principle:** Audit-Log Integrity, RLS Enforcement, State Machine Validation
- **Vorgehen:** Nur freigegebene Application-Aktionen verwenden. Für nicht unterstützte Vorfälle an Engineering eskalieren; kein ad-hoc SQL durch Operatoren.
- **Siehe:** [Betrieb: Security & Compliance Operating Rules](./04-betrieb-playbooks-und-support.md#5-security--compliance-operating-rules)

---

## Schnell-Workflow-Index

Finden Sie schnell Dokumentation für häufige Aufgaben:

### Lead-Management
- [Lead erstellen/importieren](./02-leads-pipeline-und-aufgaben.md#31-erstkontakt--anrufroutine)
- [Lead-Status ändern (Zustandsmaschine)](./02-leads-pipeline-und-aufgaben.md#12-statusübergangsregeln-zustandsmaschine)
- [Verfügbarkeitsprüfung (20h/Woche Gate)](./02-leads-pipeline-und-aufgaben.md#13-verfügbarkeitsgating-qualifikations-checkpoint)
- [Undo (Strg/Cmd+Z)](./02-leads-pipeline-und-aufgaben.md#15-rückgängigmachung-undo)

### Pipeline & Reporting
- [Pipeline-Übersicht + KPIs](./02-leads-pipeline-und-aufgaben.md#4-pipeline-betriebshandbuch)
- [Filter & Presets](./02-leads-pipeline-und-aufgaben.md#42-filter-presets-und-suche)
- [Funnel & Konversionsraten](./02-leads-pipeline-und-aufgaben.md#41-kpis-und-funnel-metrik)

### Tasks & Automation
- [Task-Lifecycle](./02-leads-pipeline-und-aufgaben.md#5-aufgaben-workflow)
- [Task-Erstellung (Routing-Engine)](./02-leads-pipeline-und-aufgaben.md#52-task-erstellen-automatisch-via-routing-engine)
- [Magic Links generieren/widerrufen](./03-kommunikation-dokumente-und-antraege.md#2-magic-links-externe-sichere-task-durchführung)

### Messaging & Approval
- [WhatsApp/E-Mail-Versand](./03-kommunikation-dokumente-und-antraege.md#1-whatsapp--und-email-versand-via-postausgang)
- [Message-Approval-Workflow (Postausgang)](./03-kommunikation-dokumente-und-antraege.md#13-die-postausgang-approval-before-send-gate)
- [Click-to-Chat (manuelle WhatsApp)](./03-kommunikation-dokumente-und-antraege.md#14-click-to-chat-wa-me-vs-api-versand)

### Dokumente & Signaturen
- [Dokument-Generierung](./03-kommunikation-dokumente-und-antraege.md#31-dokumentenmanagement-types-status-speicher)
- [Canvas-Signaturen anfordern](./03-kommunikation-dokumente-und-antraege.md#44-canvas-signatur-external-link-aktion)
- [Signatur-Finalisierung (Audit-Artifact)](./03-kommunikation-dokumente-und-antraege.md#45-signaturen-finalisierung-audit-artifact)

### Anträge & Readiness
- [Application-Status](./03-kommunikation-dokumente-und-antraege.md#33-anträge-status-readiness-submission)
- [Readiness-Blockers (Gating)](./03-kommunikation-dokumente-und-antraege.md#readiness-blockers-submission-gating)
- [Package-Export zur BA](./03-kommunikation-dokumente-und-antraege.md#package-export-antrag-paket-zum-download)

### Betrieb & Support
- [Health-Checks](./04-betrieb-playbooks-und-support.md#15-health-checks--observability)
- [Worker-Diagnostik](./04-betrieb-playbooks-und-support.md#worker-diagnostik-read-only)
- [Troubleshooting-Katalog](./04-betrieb-playbooks-und-support.md#4-safe-troubleshooting-catalog)
- [Incident Response](./04-betrieb-playbooks-und-support.md#56-incident-response-security-breach)

---

## Dokumentations-Konventionen

**Diese Wiki hält sich an diese Standards:**

### 1. Quellenverweise
Jeder Prozess wurde gegen Quellcode validiert:
- `src/app/(internal)/leads/[id]/page.tsx:123` = Lead-Detail, Zeile 123
- `src/db/schema/participants.ts:42` = Participants-Schema, Zeile 42
- Alle Zeile-Referenzen können im [GitHub-Repo](https://github.com/codekessel/sales-automation) verifiziert werden

### 2. Status-Überprüfung bei Änderungen
Wenn Seiten/Schema/Workflows sich ändern:
- [ ] Kapitel auf Relevanz überprüfen
- [ ] Zeile-Referenzen aktualisieren
- [ ] Neue Features dokumentieren
- [ ] Sicherheits-Hinweise aktualisieren (falls nötig)
- [ ] Changelog + Datum aktualisieren

### 3. Keine erfundenen Kontakte/SLAs
- **Kein Setup:** "BA ruft in 3 Tagen zurück" (nicht dokumentiert)
- **Kein Magic:** "System sendet Auto-Reminder nach 24h" (nur wenn im Code implementiert)
- **Kein Persona-Erfindung:** "Manager braucht Zugriff auf…" (nur wenn in Quellcode beweisbar)

### 4. Deutsche Terminologie konsistent halten
- **Berater:in** (nicht "Agent", "Representative", "Consultant"-English)
- **Teilnehmer:in** (nicht "Candidate", "Participant"-English)
- **Arbeitgeber:in** (nicht "Employer"-Englisch-nur-im-Code)
- **Antrag** (nicht "Application"-Englisch in deutschen Texten)
- **Postausgang** (nicht "Outbox"-Englisch)

### 5. Technische Details (Englisch)
Code, Klassennamen, Funktionen bleiben englisch:
- ✅ "Die Funktion `getLeadStatus()` in `src/modules/participants/actions-internal.ts`"
- ❌ "Die getLeadStatus-Funktion in Deutsch"

---

## Verwandte Ressourcen

- **[Design-Redesign Plan](./crm-redesign/README.md)** — UI/UX-Modernisierung, Brand-Integration, Roadmap
- **[Production-Readiness Review](../LOGIC-PR-READINESS-REVIEW.md)** — Code-Audit, P0/P1/P2 Findings
- **[Design-Audit & Marke](./crm-redesign/01-marke-und-ux-audit.md)** — Current Tokens, CodeKessel-Brand-Richtlinie
- **[Operationale Playbooks](./04-betrieb-playbooks-und-support.md)** — Betriebliche Checklisten & Troubleshooting

---

## Kontakt & Support

**Probleme oder Fragen?**
- Technisches: Kontaktiere Engineering Team
- Operationales: Kontaktiere Ops-Leitung
- Training: Kontaktiere Trainer/Support

**Für die Dokumentation selbst:**
- Fehler im Atlas? Öffne ein Issue mit Link zur Seite
- Fehlende Features? Kontaktiere Product-Lead
- Sicherheits-Bedenken? Eskaliere zu Security-Team

---

**Atlas-Version:** 1.1  
**Letztes Update:** 28. Juli 2026  
**Korrektur:** Authentifizierung vs. Autorisierung geklärt; Access-Modell-Lücken dokumentiert  
**Zielgruppe:** Benutzer (Berater:innen, Admin, Ops, Support, Schulung)  
**Sprache:** Deutsch (Betriebssprache); Code englisch (wie in codebase)
