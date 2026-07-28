# CRM-Redesign: Überblick & Planung

**Zuletzt aktualisiert:** 28. Juli 2026  
**Status:** Planungsdokumente finalisiert — UI-Implementierung noch nicht begonnen  
**Sprache:** Deutsch (Betriebssprache); Code englisch

---

## Inhaltsverzeichnis

1. [Designziel & Markenausrichtung](#designziel--markenausrichtung)
2. [Kapitel-Verzeichnis](#kapitel-verzeichnis)
3. [Ist-Zustand vs. geplante Redesign](#ist-zustand-vs-geplante-redesign)
4. [Mandatory Phase-0 Blocker](#mandatory-phase-0-blocker)
5. [Offene Owner-Entscheidungen](#offene-owner-entscheidungen)
6. [Empfohlene Implementierungsreihenfolge](#empfohlene-implementierungsreihenfolge)
7. [Wichtiger Hinweis: Nur Plan, noch keine UI-Implementierung](#wichtiger-hinweis-nur-plan-noch-keine-ui-implementierung)
8. [Brand-Asset-Intake-Checkliste](#brand-asset-intake-checkliste)

---

## Designziel & Markenausrichtung

Die **QCG Antragsplattform** wird ein professionelles, operationelles CRM für deutsche Verkaufsberater:innen in Qualifizierungsmaßnahmen. Das Redesign integriert die **CodeKessel-Markenidentität** (modernes, lernorientiertes Branding mit Violett als Primärfarbe) in ein effizientes, zugängliches System.

### Kernprinzipien

- **Dichte & Effizienz:** Layouts für Power-User; keine Marketing-Ästhetik
- **Semantische Farbcodierung:** Farbe + Text für Status; nie nur Farbe oder Emoji
- **Responsive Zugänglichkeit:** WCAG 2.2 AA Compliance; mobil unterstützt, Desktop primär
- **CodeKessel-Identität:** Violett (visuell angenähert an `#7C3AED`), tief neutral Schwarz, warme Akzente

---

## Kapitel-Verzeichnis

| Kapitel | Datei | Inhalt | Zielgruppe |
|---------|-------|--------|-----------|
| **1: Marke & UX-Audit** | `01-marke-und-ux-audit.md` | Aktuelle Token, Komponenten, Zugänglichkeit, CodeKessel-Adaptation | Design, Engineering |
| **2a: Rollen & IA & Workflows** | `02a-rollen-ia-und-workflows.md` | Operationale Personas, Informationsarchitektur, End-to-End-Workflows | Product, Operations |
| **2b: Seitenspezifikationen** | `02b-seitenspezifikationen.md` | UI-Specs für alle 12 Seiten; Kanban-Entscheidung (gated), Bulk-Ops (gated), Virtualisierung (perf-gated) | Design, Frontend |
| **3: Design-System & Rollout** | `03-designsystem-technik-und-rollout.md` | Komponenten-Architektur, WCAG 2.2 AA, Server/Client Boundary, Phase 0–4 Backlog, Migration & Rollback | Engineering |

**Status pro Kapitel:**
- `01`: ✅ Verifiziert — Current State Audit, Brand Reference
- `02a`: ✅ Verifiziert — Alle Workflows documented; P1 Blockers identifiziert
- `02b`: ✅ Verifiziert — Seitenspecs; Gating-Entscheidungen dokumentiert
- `03`: ✅ Verifiziert — Tech Plan mit Phase 0 Decision Spikes

---

## Ist-Zustand vs. geplante Redesign

| Aspekt | Jetzt | Geplant |
|--------|-------|--------|
| **Farbschema** | Generisches Blau | CodeKessel Violett + Schwarz + Warm-Akzente |
| **Komponenten-Bibliothek** | Benutzerdefiniert (CSS) | Systematische Design-System-Komponenten (15+) |
| **Icon-System** | Inline SVG/Unicode | Feather/Heroicons Standardisierung |
| **Mobile Support** | Teilweise (Detail-Grid responsive) | Vollständig (alle Seiten, 44–48px Touch-Ziele) |
| **Zugänglichkeit** | Partiell (Focus-Outline, Semantic HTML) | WCAG 2.2 AA (Audit durch Phase 4) |
| **Kanban-Board** | ❌ Nicht vorhanden | 🟡 Entscheidung ausstehend — nur nach Nutzungsvalidierung |
| **Dunkler Modus** | ❌ Nein | 🟡 Post-Launch (Phase 2+) |

---

## Mandatory Phase-0 Blocker

**Diese zwei Korrektionen MÜSSEN ERSTE erfolgen — sie sind Voraussetzungen für Production-Ready:**

### P1-1: Atomic Compare-and-Set in `approveAndDispatch` (Race Condition)

**Problem:** Zwei gleichzeitige Message-Freigaben (Double-Click oder zwei Browser-Tabs) können dieselbe WhatsApp-Nachricht zweimal versenden.

**Datei:** `src/modules/messaging/outbox.ts`, Zeilen 134–154

**Fix:** Die erste UPDATE muss ein `AND status='pending_approval'` Guard haben und RETURNING verwenden, um Race-Verlust zu erkennen.

**Referenz:** `docs/LOGIC-PR-READINESS-REVIEW.md`, Section P1-1

---

### P1-2: Deterministische pnpm Version in CI

**Problem:** `.github/workflows/ci.yml` spezifiziert keine pnpm-Version → CI kann nondeterministisch fehlschlagen.

**Datei:** `.github/workflows/ci.yml`, Zeilen 10–11

**Fix:** `version: 10` hinzufügen oder `packageManager` zu `package.json` hinzufügen.

**Referenz:** `docs/LOGIC-PR-READINESS-REVIEW.md`, Section P1-2

---

## Genehmigt: Owner-Entscheidungen (noch nicht implementiert)

**Alle diese Entscheidungen wurden vom Owner genehmigt und sind verbindlich für Phase 0–4:**

### 1. Rollenmodell: Drei interne Rollen (Genehmigt)

**Entscheidung:** Implementiere `consultant`, `manager`, `admin` (3 Rollen, nicht 4).  
**Keine Operations-Rolle:** Operations/Backoffice-Aufgaben nutzen `manager` Permissions.  
**Status:** ✅ Genehmigt  
**Implementierung:** Phase 0 Backend-Arbeit (enum/session/auth-Migration); Code behält aktuell nur consultant/admin, bis Migration abgeschlossen.

**Rollen-Übersicht:**
- `consultant`: Berater — Lead-Verwaltung, Outreach, Tasks (Assigned Records + Team Pool)
- `manager`: Geschäftsführer / Teamleiter — Team-Dashboard, Pipeline-Überwachung, Message-Genehmigung, Audit
- `admin`: Admin — Register-Import, System-Konfiguration, Audit

---

### 2. Manager Panel (Geplant; Phase 1+ Nach Rollenimplementierung)

**Entscheidung:** Implementiere dedizierten Manager Dashboard.  
**Zeigt:** Tenant-wide team pipeline, lead aging, consultant workload, task SLA, import quality, outbox approval queue, messaging outcomes, audit signals.  
**Status:** ✅ Genehmigt als Phase 1+ Feature (nach Rollen-Migration)  
**Acceptance:** Page/Route Proposal + Genehmigungskriterien = geplant; markiert als Planned.

---

### 3. Record-Sichtbarkeit: Assigned + Unassigned Pool (Genehmigt; Backend-Prerequisite Phase 0)

**Entscheidung:** Consultants sehen Records, die ihnen zugewiesen sind + controlled unassigned team pool zum Claim.  
**Manager/Admin:** Sehen alle Records im Tenant.  
**Durchsetzung:** Centralized server-side authorization/query scopes (nicht UI-Filter).  
**RLS-Grenze:** Bleibt Tenant-Boundary.  
**Status:** ✅ Genehmigt  
**Phase 0 Arbeit:** Safe claim/reassignment rules, manager override, audit events, test requirements definieren.

---

### 4. Message-Genehmigung: Separation of Duties (Genehmigt)

**Entscheidung:** Consultants entwerfen Drafts; manager/admin genehmigt.  
**Critical:** Creator kann ihren eigenen Draft NICHT genehmigen (Separation of Duties).  
**System-generated messages:** Erfordern auch manager/admin Genehmigung.  
**Approvers:** Einer reicht aus; NOT zwei simultane Genehmiger erforderlich.  
**Status:** ✅ Genehmigt  
**Phase 0 Schema-Needs:** `created_by` / `requested_by`, atomic approval CAS.  
**Blocker:** Double-send race muss als MANDATORY P1 Fix vor Production gelöst sein.  
**Hinweis:** Click-to-chat bleibt manual user-controlled; außerhalb Cloud API auto-dispatch.

---

### 5. Styling: Inkrementelle Tailwind-Adoption + Semantic Tokens (Genehmigt)

**Entscheidung:** Incremental Tailwind adoption mapped to semantic CodeKessel design tokens.  
**Preservation:** Vorhandenes CSS während Migration behalten; kein Big-Bang Rewrite.  
**Gradients:** Keine Standardmäßig.  
**Brand-Werte:** Offizielle Werte use once supplied.  
**Status:** ✅ Genehmigt  
**Phase 0:** Implementation spike → config/token mapping, coexistence strategy, purge/content paths, regression strategy dokumentieren.  
**Phase 0:** Decision Spike von 'decision spike' zu implementation spike/architecture validation aktualisiert.

---

### 6. Accessible Primitives: Native First, Radix für Complex (Genehmigt)

**Entscheidung:** Native semantic elements first; Radix primitives nur für complex dialog/popover/menu/select/tooltip wo native behavior nicht reicht.  
**Styling:** Tailwind/semantic tokens; keine generic visual defaults.  
**Status:** ✅ Genehmigt  
**Phase 0:** Dependency/bundle check = implementation validation, nicht offene Produktwahl.

---

### 7. Kanban: Optional Secondary View (Geplant; Hinter Validierung)

**Entscheidung:** Include optional secondary pipeline Kanban view.  
**Table:** Bleibt default.  
**Initial Kanban:** Read/triage oriented; cards open explicit validated transition actions.  
**Drag-and-drop:** NEIN in first release; direct drag-drop status mutation NOT supported.  
**Drag-Drop Reconsideration:** Nur nach safe server semantics, confirmation, audit, user validation.  
**Status:** ✅ Genehmigt als Phase 2+ Optional Feature (hinter Nutzer-Validierung).

---

### 8. Outbox History: Pending + History Views (Genehmigt)

**Entscheidung:** Add Pending und History Views.  
**History Display:** Backend-supported dispatch/delivery states: sent, failed, delivered, read, rejected/cancelled (wo applicable).  
**Provider vs. Delivery:** Distinguish provider acceptance from delivered/read.  
**Filters/Date Range:** URL-driven.  
**Bounced State:** NICHT erfunden; nicht in backend enums.  
**Status:** ✅ Genehmigt  
**Phase 2:** UI-Implementation nach backend state verification.

---

### 9. Dark Mode: Explizit NICHT erforderlich (Genehmigt Ausgeschlossen)

**Entscheidung:** Explizit NICHT erforderlich und aus Redesign-Scope ausgeschlossen.  
**Status:** ✅ Genehmigt Closed Decision — diese ist NICHT offen.

---

### 10. Mandatory Phase 0 Blockers (Genehmigt)

**Entscheidung:** Atomic approval compare-and-set + concurrency test muss vor Production gelöst sein.  
**Zusätzlich:** Role/authorization + message-author schema changes als Phase 0 Backend prerequisites.  
**Deterministic CI:** pnpm version in CI festlegen.  
**Status:** ✅ Genehmigt als Mandatory Phase 0 Work.

---

## Empfohlene Implementierungsreihenfolge

### Phase 0: Blocker-Behebung & Architekturvalidierung

1. **Fix P1-1 & P1-2** (oben) — blockt alles
2. **Owner Decisions Dokumentiert** (siehe oben):
   - ✅ Rollenmodell: 3 Rollen (consultant, manager, admin) — genehmigt
   - ✅ Manager Panel: Geplant für Phase 1+
   - ✅ Record Visibility: Assigned + Team Pool — Backend Phase 0
   - ✅ Message Approval: Separation of Duties — Backend Phase 0
   - ✅ Styling: Incremental Tailwind + Semantic Tokens — Phase 0 Spike
   - ✅ Accessible Primitives: Native + Radix where needed — Phase 0 Spike
   - ✅ Kanban: Optional Secondary View — Phase 2+ (User Validation)
   - ✅ Outbox History: Pending + History Views — Phase 2 (Backend State Verification)
   - ✅ Dark Mode: Explizit NICHT required — Closed Decision
3. **Phase 0 Architecture Spikes:**
   - CSS-Token vs. Tailwind mapping (implementation spike)
   - Accessible primitives bundle/a11y analysis
4. **Brand-Asset-Intake starten** (siehe Checkliste unten)

**Ausgabe:** Approved Owner Decisions + Component Spec + Design System Plan

---

### Phase 1: Foundation

**Ziel:** Alle 15+ Design-System-Komponenten in Demo-Seite zeigen

1. Token-Erweiterung (Z-Index, Transitions)
2. AppShell, Sidebar, Topbar
3. Button, Badge, Form, Input, Select
4. Modal, Drawer, Toast, Banner
5. Table, FilterBar, Timeline
6. Skeleton, EmptyState, ErrorFallback
7. CommandBar (Cmd+K global search)
8. Demo-Seite + a11y Tests

**Ausgabe:** PR 1.1–1.15 (15 PRs)

---

### Phase 2: Kern-Workflows

**Ziel:** Alle operationellen Seiten migrieren

1. Pipeline (`/pipeline`)
2. Leads (`/leads/[id]`)
3. Tasks (`/tasks`)
4. Outbox (`/outbox`)
5. Keyboard Nav Testing
6. Mobile Responsive
7. Integration Tests

**Ausgabe:** PR 2.1–2.8

---

### Phase 3: Manager-Panel & unterstützende Workflows

1. Dokumente, Anträge, Reports
2. Arbeitgeber, Import
3. Admin Pages
4. Data-Driven Testing

**Ausgabe:** PR 3.1–3.6

---

### Phase 4: Responsive-Polish & Audit

1. Device Testing
2. Analytics Events
3. Reduced Motion + Performance (Lighthouse ≥90 diagnostic)
4. **Full WCAG 2.2 AA Manual Audit** (Keyboard + Screen Reader + Axe)

**Ausgabe:** PR 4.1–4.4, Final Release Docs

---

**Zeitplanung:** Erst nach Phase 0 durch das benannte Umsetzungsteam. Die Schätzung muss Review, Migration, QA, Accessibility, Operator-Abnahme und Rework enthalten.

---

## Wichtiger Hinweis: Nur Plan, noch keine UI-Implementierung

⚠️ **KRITISCH:** Diese Dokumentation beschreibt **geplante** Änderungen. **KEINE UI ist umgesetzt.** Der Codebase funktioniert wie heute:

- ✅ Benutzerdefinierte Tokens (CSS custom properties)
- ✅ Aktuelle Komponenten-Styles
- ✅ Aktuelle Farbpalette (generisches Blau, nicht CodeKessel Violett)

**Alle Designänderungen finden NUR während Phase 1–4 statt.**

**CodeKessel Violett ist nur eine visuelle Näherung** (`~#7C3AED`), **bis offizielle Brand-Assets und kanonische Farbwerte bereitgestellt werden** (siehe Asset-Checkliste unten).

---

## Brand-Asset-Intake-Checkliste

**Erforderlich von CodeKessel Brand-Team vor Phase 1 Design-Implementierung:**

### Logo & Markenzeichen
- [ ] **Primäres Mark** (Icon, quadratisches Format)
  - [ ] Schwarz-Variante
  - [ ] Weiß-Variante
  - [ ] Violett-Variante
  - [ ] SVG-Dateien
- [ ] **Horizontales Lockup** (Markenzeichen + Wortmark)
  - [ ] Schwarz auf Weiß
  - [ ] Weiß auf dunkel
  - [ ] Violett-Variante
- [ ] **Favicon**
  - [ ] `.ico` (16px, 32px)
  - [ ] `.png` (192px, 512px PWA)

### Farben & Theme
- [ ] **Offizielle Farbpalette** (Figma oder Spezifikation)
  - [ ] Primär-Violett (hex, RGB, OKLCH)
  - [ ] Sekundär-Schwarz
  - [ ] Akzent-Farben (Cyan, Gold, Mint, Cream)
- [ ] **Typografie**
  - [ ] Font-Familie (lizenziert für Web/App)
  - [ ] Font-Dateien (.woff2, .woff)
  - [ ] Font-Gewichte in Verwendung (400, 500, 600–700)
  - [ ] Lizenzbedingungen (SaaS/App-Abdeckung)

### Bilder & Illustrationen
- [ ] **Brand-Charakter/Maskottchen** (falls verwendet)
  - [ ] 5–10 SVG-Illustrationen (Posen/Ausdrücke)
  - [ ] Usage-Richtlinien
- [ ] **Unterstützende Bilder**
  - [ ] Code-Snippet-Grafiken (leere States, Onboarding)
  - [ ] Bracket/Cauldron-Icon-Variationen
  - [ ] Lehr-Grafiken (Teamwork, Wachstum, Lernen)

### Richtlinien
- [ ] **Brand-Buch oder Richtlinien**
  - [ ] Logo-Nutzung & Schutzbereich
  - [ ] Farbpalette & Anwendungen
  - [ ] Typografie-Regeln
  - [ ] Tonalität der Stimme
  - [ ] Do's & Don'ts
  - [ ] PDF oder Figma-Datei

---

## Zusammenfassung

Das CRM-Redesign ist eine **8-Wochen-Anstrengung** zur Integration von CodeKessel-Markenidentität, modernem Komponenten-System und WCAG 2.2 AA Zugänglichkeit. Die Planung ist **abgeschlossen**; UI-Implementierung **steht aus**.

**Nächste Schritte:**
1. ✅ Phase-0 Blocker beheben (P1-1, P1-2)
2. ✅ Owner-Entscheidungen treffen (9 offene Entscheidungen)
3. ✅ Brand-Assets anfordern (Checkliste oben)
4. ✅ Phase 0 Spikes durchführen (CSS/Tailwind, Accessible Primitives)
5. 🟡 Phase 1 starten (nach Genehmigung)

**Kontakt:** Product Lead (Design-Entscheidungen), Tech Lead (CSS/Architektur-Spike), Engineering-Team (Implementation)

---

**Dokumentversion:** 1.0  
**Erstellt:** 28. Juli 2026  
**Status:** Owner-Entscheidungen genehmigt; keine Redesign-Implementierung gestartet. Phase 0 beginnt erst nach expliziter Beauftragung.
**Sprache:** Deutsch (Betriebssprache)
