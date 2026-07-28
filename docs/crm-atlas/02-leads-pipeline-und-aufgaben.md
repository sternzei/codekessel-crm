# CRM-Atlas Kapitel 2: Leads, Pipeline und Aufgaben

**Zielgruppe:** Sales-Consultant, Verwaltungsleitung, Systemadministrator  
**Aktualisiert:** 28. Juli 2026  
**Sprache:** Deutsch (Benutzeroberfläche), Code/Technisch: Englisch (mit Annotation)

---

## Inhaltsverzeichnis

1. [Teilnehmer-Lebenszyklus](#1-teilnehmer-lebenszyklus)
2. [OpenRegister-Unternehmensermittlung](#2-openregister-unternehmensermittlung)
3. [Tägliche Routine des Sales-Consultants](#3-tägliche-routine-des-sales-consultants)
4. [Pipeline-Betriebshandbuch](#4-pipeline-betriebshandbuch)
5. [Aufgaben-Workflow](#5-aufgaben-workflow)

---

## 1. Teilnehmer-Lebenszyklus

Ein Lead (Interessent) durchläuft in CODEKESSEL ein streng definiertes Statusmodell. Jeder Statuswechsel ist kontrolliert, dokumentiert und kann Automation auslösen. Das System führt eine vollständige Audit-Spur, implementiert Rückgängigmachung und verhindert ungültige Übergänge.

### 1.1 Statusübersicht

Die folgenden 13 Statuses bilden den Lebenszyklus. Alle sind in der PostgreSQL-Enum `participant_status` definiert ([`src/db/schema/enums.ts:8–23`](../../src/db/schema/enums.ts)).

| Status | Phase | Beschreibung | Zielgruppe |
|--------|-------|-------------|-----------|
| **new** | Kontaktversuch | Neue Leads, noch nicht angerufen | Sales-Consultant |
| **called** | Kontaktversuch | Angerufen, aber nicht erreicht (Besetzzeichen, VM hinterlassen) | Sales-Consultant |
| **not_reachable** | Kontaktversuch | Nach mehreren Versuchen nicht erreichbar (Datenfehler wahrscheinlich) | Sales-Consultant |
| **wrong_number** | Kontaktversuch | Ungültige Telefonnummer bestätigt | Sales-Consultant |
| **interested** | Kontaktversuch | Kurzgespräch geführt, Interessensbekundung da | Sales-Consultant |
| **not_interested** | Terminal (Ausstieg) | Interessent lehnt ab (Ende) | Sales-Consultant |
| **eligibility_unclear** | Kontaktversuch | Fragen zur Eignung offen, Rücksprache mit Arbeitgeber nötig | Sales-Consultant |
| **employer_pending** | Verifikation | Arbeitgeber-Überprüfung läuft (Betriebsnummer, Anzahl MA) | System/Consultant |
| **qualified** | Phase-Kette | 20h/Woche + 6 Monate bestätigt → Qualifizierungsgespräch absolviert | Sales-Consultant |
| **test_phase** | Phase-Kette | Eignungstest abgeschlossen, Testphase startet | System |
| **documents_phase** | Phase-Kette | Dokumente eingereicht, Signatur ausstehend | System |
| **application_phase** | Phase-Kette | Antrag zu BA-Genehmigung eingereicht | System |
| **enrolled** | Terminal (Erfolg) | Zugelassung durch BA + Enrollment bestätigt (Ende) | System |
| **lost** | Terminal (Ausstieg) | Jederzeit erreichbar, wenn Lead ausfällt | Sales-Consultant |

**Implementierung:** [`src/db/schema/participants.ts:37`](../../src/db/schema/participants.ts)  
**Test:** [`tests/unit/participant-transitions.test.ts`](../../tests/unit/participant-transitions.test.ts)

---

### 1.2 Statusübergangsregeln (Zustandsmaschine)

Das System hat eine strikte Übergangskontrolle. Nur bestimmte Übergänge sind erlaubt; unerlaubte Übergänge werfen einen `ParticipantTransitionError`.

#### 1.2.1 Übergangsmuster

**Muster 1: Frühe Kontaktphase (gegenseitig erreichbar)**

Alle Status `{new, called, not_reachable, wrong_number, interested, not_interested, eligibility_unclear}` sind untereinander erlaubt. Das erlaubt dem Sales-Consultant, Anrufe zu wiederholen, Statuses zu korrigieren und schnelle Aktionen im Call-Skript zu ermöglichen.

- ✅ `new` → `called`, `not_reachable`, `interested`, …
- ✅ `called` → `new`, `interested`, `wrong_number`, …
- ✅ `interested` → `called`, `eligibility_unclear`, …

**Muster 2: Arbeitgeber-Überprüfung**

Jeden Status der Kontaktphase kann man in `employer_pending` schicken (Überprüfung auf Betriebsnummer) oder direkt zu `qualified` springen (wenn Eligibility bereits klar ist).

- ✅ `interested` → `employer_pending` → `qualified`
- ✅ `eligibility_unclear` → `employer_pending` → `eligibility_unclear` (Ergebnis ausstehend)

**Muster 3: Lineare Phase-Kette (nach Qualifizierung)**

Nach `qualified` ist die Reihenfolge streng linear. Jeder Status ist nur auf den nächsten erreichbar (keine Sprünge, keine Rückgänge).

```
qualified → test_phase → documents_phase → application_phase → enrolled
```

- ✅ `qualified` → `test_phase` (und nur das)
- ✅ `test_phase` → `documents_phase` (und nur das)
- ❌ `qualified` → `documents_phase` (Sprung verboten)
- ❌ `test_phase` → `qualified` (Rückgang verboten)

**Muster 4: Abbruch (lost-Ausweg)**

Von jedem nicht-terminalen Status kann man zu `lost` wechseln (Einmal-Ausgang, alle anderen Statuses erreichbar).

- ✅ `new` → `lost`, `called` → `lost`, `qualified` → `lost`, …
- ✅ `lost` → kein Ausweg (Terminal)

**Implementierung:**  
- Kern-Logik: [`src/modules/participants/status-machine.ts:33–68`](../../src/modules/participants/status-machine.ts)
- Predikats-Funktion: [`src/modules/participants/status-machine.ts:80–86`](../../src/modules/participants/status-machine.ts)
- Verarbeitungslogik: [`src/modules/participants/transitions.ts:71–112`](../../src/modules/participants/transitions.ts)

---

### 1.3 Verfügbarkeitsgating (Qualifikations-Checkpoint)

Das System erzwingt einen kritischen Gate bei bestimmten Statuses: Die **20 Stunden/Woche über ca. 6 Monate** müssen mit eindeutigem **"Ja"** bestätigt sein, sonst wird der Übergang blockiert.

```
availability_status ∈ {yes, probably_employer_pending, partial, not_possible, unclear}
```

Gated statuses: `{qualified, test_phase, documents_phase, application_phase, enrolled}`

**Beispiel:**
- Lead antwortet: "Vielleicht (partial)" → Übergang zu `qualified` wird blockiert mit `AvailabilityGateError`
- Lead antwortet: "Ja (yes)" → Übergang freigegeben
- Admin genehmigt Antrag direkt → `skipAvailabilityGate` wird gesetzt, Gate übersprungen (weil Genehmigung selbst die Verfügbarkeit bestätigt)

**Dokumentierte Fehler:**  
- `AvailabilityGateError`: [`src/modules/participants/transitions.ts:26–32`](../../src/modules/participants/transitions.ts)

**Behandlung:** Catch in UI, Task für Lead zur Verfügbarkeitsfrage erzeugen.

---

### 1.4 Automation bei Statuswechsel (Routing-Engine)

Jeder Statuswechsel feuert den **Routing-Engine** (Regelwerk-basiert). Das System:
1. Lädt alle aktiven Routing-Regeln für `(triggerEntity, triggerStatus)`
2. Erstellt für jede Regel eine Aufgabe (bei Zieltypen: lead, employer, …)
3. Erzeugt Magic-Links für externe Adressaten
4. Sendet Meldungen (WhatsApp, E-Mail, intern)
5. Plant Erinnerer-Jobs

**Beispiel-Kette:**
```
Lead status: new → called
  → triggerEntity=participant, triggerStatus=called
  → Regel: "called leads benötigen Follow-up-Aufgabe innerhalb 1 Tag"
    → Task erstellt für Consultant: "Follow-up call"
    → Reminder geplant: 1 Tag später
```

**Idempotenz:** Das System verhindert Stapel von Aufgaben für denselben Lead-Status-Übergang. Pro (Tenant, TaskTyp, Owner, Subject) darf maximal eine AKTIVE Aufgabe existieren. Die Eindeutig-Beschränkung ist auf DB-Ebene implementiert (eindeutiger Partial-Index).

**Implementierung:**  
- Engine: [`src/modules/routing/engine.ts:56–250`](../../src/modules/routing/engine.ts)
- Verarbeitungskette: [`src/modules/participants/transitions.ts:98–111`](../../src/modules/participants/transitions.ts)

**Audit-Spur:** Jeder Übergang wird in `activity_log` geloggt mit:
- `actor_kind`: "internal_user" | "participant" | "system"
- `actor_user_id`: Wer den Übergang ausgelöst hat
- `subject_kind`: "participant"
- `subject_id`: Lead-ID
- `event`: "status_changed"
- `meta`: `{status: <neue Status>}`

Implementierung: [`src/modules/routing/engine.ts:60–68`](../../src/modules/routing/engine.ts)

---

### 1.5 Rückgängigmachung (Undo)

**Status der Undo-Funktionalität:**
- **Implementiert & in Produktion:** Direkter DB-Schreibvorgang (Spalte `status` wird unmittelbar geändert). Undo-Funktion: `undoLastAction()` im Konsolen-Formular (Ctrl/Cmd+Z)
- **Geplant (Plan.md §186):** Erweitertes Transaktions-Journal für Undo mit vollständigem Versionsverlauf

**Sicherheit:** Nur Administratoren können Undo durchführen. Die Implementierung lädt den aktuellen Datensatz, ändert die Spalte ohne Transitionsvalidierung (`skipTransitionGuard: true`) und protokolliert es als separates Activity-Log-Event.

**Vorsicht:** Undo-Operationen umgehen die Zustandsmaschinen-Validierung. Falsches Undo kann zum Konsistenzbruch führen (z. B. zurück zu `new`, wenn die Aufgaben-Kette bereits gestartet ist).

---

### 1.6 Fehlerbehandlung & Wiederherstellung

**Typische Fehler:**

| Fehler | Ursache | Behebung |
|--------|--------|----------|
| `ParticipantTransitionError` | Unerlaubter Statusübergang | Überprüfen Sie die Zustandsmaschinen-Regeln (Abschnitt 1.2). Undo nötig? |
| `AvailabilityGateError` | 20h/6-Monate nicht klar "Ja" | Task für Lead-Rücksprache erstellen; dann Verfügbarkeit aktualisieren |
| `Participant not found` | Ungültige Lead-ID | ID korrekt? Ist Lead gelöscht? |
| Task-Duplikat-Fehler | Gleichzeitige Status-Übergänge | Eindeutiger Partial-Index verhindert Rasse-Condition; Wiederholung sollte harmlos sein |

---

## 2. OpenRegister-Unternehmensermittlung

Leads können manuell erstellt oder **via OpenRegister** importiert werden (Unternehmen in finanzieller Schieflage, potenzielle AZAV-Kandidaten).

### 2.1 Entdeckungs-Kriterien und Filter

**OpenRegister API-Filter (Server-seitig):**
- `status=active` (nur aktive Unternehmen)
- `employees_min` / `employees_max` (z. B. 10–50)
- `net_income<0` (Verlust, nicht Gewinn)

**Client-seitige Filter (nach API-Rückmeldung angewendet):**
- **Bundesland** (PLZ-Vorsilben-Mapping): Default `baden-wuerttemberg` (68–79, 88–89)
- **Rechtsform** (Substring-Vergleich, case-insensitive): GmbH, UG, AG, KG, GmbH & Co. KG, …

Die Client-seitige Eingrenzung ist notwendig, weil OpenRegister diese Felder nicht dokumentieren/bestätigen (`address.city`, `legal_form` nur nach dem Abrufen verfügbar).

**Konfigurierbar:** Bundesland-Mapping in [`src/modules/register/filters.ts:25–51`](../../src/modules/register/filters.ts), Labels in [`src/modules/register/filters.ts:54–71`](../../src/modules/register/filters.ts).

**Implementierung:** [`src/modules/register/filters.ts`](../../src/modules/register/filters.ts)  
**Test:** [`tests/unit/register-filters.test.ts`](../../tests/unit/register-filters.test.ts)

---

### 2.2 Unternehmens-Deduplizierung & Stabile Identität

Jede OpenRegister-Entdeckung hat eine stabile Kennung: **`register_id`** (Handelsregister-Unternehmens-ID). Das System stellt sicher:

1. **Eindeutigkeit pro Tenant:** `UNIQUE INDEX participants_tenant_register_idx (tenant_id, register_id) WHERE register_id IS NOT NULL`
2. **NULL-Unterscheidung:** Manuell erstellte Leads haben `register_id=NULL`, kollidieren also nicht mit importierten
3. **Neuimporte:** Lädt derselbe Datensatz erneut ein, wird ein bestehendes Datensatz geprüft; neue Felder werden hinzugefügt, ohne Status zu ändern

**Spalte `registerId`:** [`src/db/schema/participants.ts:59`](../../src/db/schema/participants.ts)  
**Eindeutig-Beschränkung:** [`src/db/schema/participants.ts:137–139`](../../src/db/schema/participants.ts)

---

### 2.3 Arbeitgeber-Erstellung und Verknüpfung

Bei OpenRegister-Import wird automatisch ein Arbeitgeber-Datensatz erstellt (falls noch nicht vorhanden):

```
OpenRegister company_id → employer (company_name, register_id, …)
  ↓
Import-Kriterien gespeichert (criteria JSON: {companyId, profitEur, fiscalYear, …})
  ↓
Participant created/updated mit foreign_key employer_id
```

**Employer-Status:** Startet als `new`, kann durch die Administrations-UI in `invited` / `setup_in_progress` / `confirmed` / `declined` usw. übergeben.

**Deduplizierung auf Arbeitgeber-Ebene:** Ein `register_id` wird pro Tenant nur einmal importiert. Versuche, denselben Arbeitgeber erneut zu importieren, führen zu Outcomes: `skipped` (keine Änderung) oder `updated` (neue Felder).

---

### 2.4 Finanzielle Provenance

Das System speichert die Entdeckungssignale dauerhaft als strukturierte Spalten (neben der menschenlesbaren `eligibility_notes`):

| Spalte | Beschreibung | Typ | Beispiel |
|--------|-------------|-----|---------|
| `netIncome` | Nettoeinkommen (VZ: Minus = Verlust) | `numeric(14,2)` | `-45000.00` |
| `financialYear` | Berichtsjahr | `integer` | `2024` |
| `financialsSource` | Quelle der Figur | `text` | `"indicators"`, `"search_row"` |

**Keine Koerzion:** Ein fehlender Wert bleibt `NULL`, wird nicht zu `0` konvertiert. Das ist wichtig für Datenqualität.

**Spalten-Definition:** [`src/db/schema/participants.ts:66–77`](../../src/db/schema/participants.ts)

---

### 2.5 Import-Läufe und Partielle Fehler

Ein Import kann sein:
- **Einzel-Importlauf:** Eine einzelne Unternehmen-ID (z. B. von Register-Suche)
- **Batch-Importlauf:** Seitenweise Suche mit Filterkriterien (z. B. 25 Unternehmen pro Seite, Seite 2)

**Status eines Importlaufs:**
- `running` — In Bearbeitung
- `completed` — Erfolgreich abgeschlossen
- `failed` — Kritischer Fehler (z. B. API unerreichbar)

**Pro-Unternehmen-Outcomes:**
- `inserted` — Neuer Lead erstellt
- `updated` — Existierender Lead mit neuen Register-Daten aktualisiert
- `skipped` — Lead existiert, keine neuen Informationen
- `conflicted` — `register_id` existiert, aber unter anderem Arbeitgeber → manuelles Review erforderlich

**Import-Statistiken:** Alle Outcomes in `import_runs.stats` (JSONB) gespeichert:

```json
{
  "inserted": 3,
  "updated": 1,
  "skipped": 2,
  "conflicted": 0
}
```

**Partielle Fehler:** Ein Fehler bei einer Unternehmen stoppt nicht den Gesamtlauf; der Fehler wird pro Eintrag protokolliert, und der Lauf wird `completed` (mit Fehler-Counter).

**Implementierung:** [`src/modules/register/import-run.ts`](../../src/modules/register/import-run.ts)

---

### 2.6 Admin-Restriktionen (Nur Administratoren)

**Folgende Operationen erfordern `role='admin'`:**
1. Import-Lauf starten (Enddatum Abfrage, Filterkriterien)
2. Manueller Abbruch eines laufenden Imports
3. Neustart fehlgeschlagener Imports
4. Änderung von Import-Konfigurationen

**Nicht-Admins** sehen die Import-Historie, können aber nicht starten/ändern.

**Session-Prüfung:** Jede interne Aktion prüft die Sitzung erneut (nicht nur Layout-Guard). Code: [`src/modules/participants/actions-internal.ts:52–56`](../../src/modules/participants/actions-internal.ts)

---

## 3. Tägliche Routine des Sales-Consultants

### 3.1 Start des Arbeitstags: Pipeline-Review

Der Consultant loggt sich ein und öffnet die **Pipeline-Ansicht** (`/leads`). Das Dashboard zeigt:

1. **Funnel-Statuses** (Count pro Status):
   - `new` (7 Tage): Ältere noch nicht angerufen → Bottleneck
   - `called` / `not_reachable` / `wrong_number`: Nicht erreichbar
   - `interested`: Wartet auf Folgegespräch
   - `employer_pending`: In Admin-Prüfung
   - `qualified` und darüber: Fortschritt

2. **Datenschätze** (Datenqualitäts-KPIs):
   - Fehlende Telefonnummern
   - Fehlende E-Mail-Adressen
   - `wrong_number`-Leads (Datenfehlerkandidaten)

3. **Import-Frische**:
   - Letzter erfolgreicher Import: Zeitstempel, Stats
   - Laufende Importe
   - Gescheiterte Importe (erfordert Admin-Aufmerksamkeit)

**Filterung:** Der Consultant kann Leads nach `status`, `consultant_id`, `source`, `created_date_range`, `phone_presence`, `email_presence` und Freitext-Suche filtern (über [`src/modules/participants/pipeline-filter.ts`](../../src/modules/participants/pipeline-filter.ts)).

---

### 3.2 Priorisierung

**Automatische Priorisierung nach Regeln:**

1. **Stale New (>7 Tage, status=new):** Höchste Priorität — alte Daten könnten falsch sein
2. **Employer Pending:** Auf Admin warten; Consultant kann Parallel-Leads bearbeiten
3. **Interested:** Zeitgebunden (Verfügbarkeitsgespräch heute/morgen)
4. **Qualified:** Phasenkette startet → dokumentieren, Vertrag vorbereiten

**Persönliche Task-List:** Der Consultant hat auch persönliche Aufgaben (nicht Lead-spezifisch):
- "Alle Arbeitgeber-Verträge prüfen bis 16:00"
- "3 Leads für Aptitude-Test einladen"

Diese werden über die **Aufgaben-Seite** zugeteilt.

---

### 3.3 Erstkontakt & Anrufroutine

**Scenario: Consultant wählt Lead `Matthias Weber`, Status=`new`**

1. **Lead-Detailansicht öffnet:**
   - Name, Telefon (normalisiert), E-Mail, Adresse, Quelle (z. B. "openregister")
   - Verfügbarkeitsstatus (aktuell: `unclear`)
   - Arbeitgeber (falls OpenRegister-Import)
   - Finanzielle Daten (Nettoeinkommen, Geschäftsjahr, falls verfügbar)
   - Anruf-Historie (Activity Log)

2. **Anruf-Skript startet:**
   - System zeigt: Gesprächsleitfaden mit Screening-Fragen
   - DSGVO-Information vor dem Anruf ("Recht des Widerspruchs")
   - Consultant führt Anruf durch
   - Nach dem Anruf klickt einen von 6 Gesprächsergebnissen (implementiert):
     - "Angerufen" → Status: `called` (nicht erreicht, hinterlassene Nachricht)
     - "Interessiert" → Status: `interested` (bestätigte Interessensbekundung)
     - "Nicht erreicht" → Status: `not_reachable` (mehrere Versuche erfolglos)
     - "Falsche Nummer" → Status: `wrong_number` (ungültige Nummer bestätigt)
     - "Förderung unklar" → Status: `eligibility_unclear` (Eligibility-Fragen offen; Task wird erzeugt)
     - "Kein Interesse" → Status: `not_interested` (Lead lehnt aktiv ab; terminal)

3. **Statusübergang ausgelöst:**
   - Zustandsmaschine validiert
   - Routing-Engine feuert Regeln
   - Task für nächsten Schritt erzeugt (z. B. "Arbeitgeber-Überprüfung anfordern")
   - Audit-Eintrag erstellt

---

### 3.4 Qualifizierungsgespräch

**Scenario: Lead ist `interested`, Consultant vereinbart ein Termin**

1. **Termin-Buchung (Appointment):**
   - Typ: `consultation` (60 Min)
   - Scheduler zeigt verfügbare Zeiten
   - Lead erhält Einladung (E-Mail + Magic-Link zur Bestätigung)

2. **Verfügbarkeitsfrage:**
   - Vor oder während Termin: "20h/Woche über 6 Monate — Ja, Vielleicht, oder Nein?"
   - System aktualisiert `availabilityStatus`
   - Wenn Nein → Task: "Alternatives Angebot für Teil-Zeit recherchieren"
   - Wenn Ja → Übergang zu `qualified` wird freigegeben

3. **Dokumente hochladen:**
   - Lead lädt via Magic-Link hoch: Ausweisdokument, Arbeitsvertrag, letzter Gehaltszettel
   - System speichert in `documents` (polymorphe Tabelle)
   - Consultant prüft & markiert als `reviewed` → `approved`

---

### 3.5 Datenssammlung & Feldverfolgung

Das System speichert **optionale, additive Felder** für BA-Antrag (Plan.md §186):

| Feld | Typ | Beispiel | Nötig für |
|------|-----|---------|----------|
| `svNumber` | text | `"12 345678 S 999"` | BA-Antrag |
| `iban` | text | `"DE89370400440532013000"` | Zahlungen |
| `monthlyGrossSalary` | numeric | `3500.00` | Förderberechnung |
| `salaryComponents` | jsonb array | `[{name: "Weihnachtsgeld", amount: 500}]` | Gesamteinkommen |
| `weeklyWorkingHours` | numeric | `40.0` | Zeit-Modell |
| `schulungszeiten` | jsonb object | `{Mo: "08:00-10:00", Di: "..."}` | Freistellung |

Diese Felder werden über Konsolen-Formulare oder direktes Lead-Update ausgefüllt.

**Implementierung:** [`src/db/schema/participants.ts:85–121`](../../src/db/schema/participants.ts)

---

### 3.6 Folgemaßnahmen & End-of-Day-Checks

**Empfohlener Betriebsprozess vor Feierabend:**

1. ✅ Alle `new` und `called` Leads heute bearbeitet?
2. ✅ Alle `eligibility_unclear` Leads Aufgaben-Zuweisung erhalten?
3. ✅ Alle `interested` Leads einen Termin-Link erhalten?
4. ✅ Task-Board überprüft (alle zugewiesenen Aufgaben aktualisiert)?

**System-Benachrichtigungen (geplant):**
- Morgen-Zusammenfassung: Stale-new leads, employer_pending leads, offene Tasks (Geplant)
- End-of-day-Erinnerung: Offene Tasks abschließen oder verschieben (Geplant)

**Aktuelle Unterstützung:**
- Handbearbeitete Pipeline-Ansicht mit Filtern für Priorisierung (Status, Consultant, Alter)
- Alert-Zähler: `getPipelineAlerts()` zeigt Bottleneck-Counts

---

## 4. Pipeline-Betriebshandbuch

### 4.1 KPIs und Funnel-Metrik

Das System berechnet automatisch Counts pro Status und Aggregates:

**Statusverteilung (Funnel):**
- Aggregations-Query (gruppiert nach `status`, zählt pro Tenant/Filter)
- Resultat: `{new: 12, called: 8, interested: 5, qualified: 2, enrolled: 1, lost: 3}`

**Kontakt-Erfolgsrate:**
- REACHED_STATUSES = `{interested, eligibility_unclear, qualified, test_phase, …}`
- Formel: `reached / (reached + not_reached + new)`

**Phasen-Konversionsrate:**
- APPLICATION_PLUS = `{application_phase, enrolled}`
- Formel: `enrolled / application_plus` (Zugangsquote BA)

**Datenschätze (Coverage):**
- Mit Telefon, Mit E-Mail, Ohne Telefon, Ohne E-Mail

**Implementierung:** [`src/modules/participants/pipeline.ts:25–68`](../../src/modules/participants/pipeline.ts)

---

### 4.2 Filter, Presets und Suche

Die Pipeline-UI erlaubt Kombinationsfilter:

```
Status: [new, called, interested, …] (Multi-Select)
Consultant: [Consultant A, Consultant B, Unassigned] (Dropdown)
Source: [openregister, manual, …] (Dropdown)
Created: from [Date] to [Date] (Date Range)
Phone: [with / without] (Radio)
Email: [with / without] (Radio)
Search: "Matthias" (Freitext-Name)
```

**Kombiniert:** Status=`new` AND Created>7 days ago → "Stale New"  
**Kombiniert:** Status=`interested` AND Consultant=`NULL` → "Interessierte, unzugeordnet"

**Filter-Bedingungen-Builder:** [`src/modules/participants/pipeline-filter.ts:148–300`](../../src/modules/participants/pipeline-filter.ts)

**Gespeicherte Presets:** Nicht implementiert, geplant (Benutzer können Filter speichern als URLs)

---

### 4.3 Paginierung & Export

**Paginierung:**
- Standard: 25 Rows/Seite
- Sortierung: Nach Name, Erstellt, Aktualisiert, Status (Auf/Absteigend)
- Max: 100 Rows/Seite

**CSV-Export:**
- Limit: 10.000 Rows (ungepaginiert)
- Spalten: Name, Status, Stadt, Quelle, Consultant, Telefon, E-Mail, Erstellt, Aktualisiert
- Encoding: UTF-8 (German Umlaute OK)

**Implementierung:** [`src/modules/participants/pipeline.ts:288–338`](../../src/modules/participants/pipeline.ts)

---

### 4.4 Status-Interpretation (für Nicht-Techniker)

| Status | Bedeutung für Consultant | Handlung |
|--------|-------------------------|----------|
| `new` | Noch nicht angerufen | Heute anrufen; Datenkorrektheit prüfen |
| `called` | Angerufen, nicht erreicht | Erneut anrufen morgen; oder `not_reachable` setzen |
| `not_reachable` | Nach mehreren Versuchen nicht erreichbar | Datenfehler wahrscheinlich; in `wrong_number` oder `lost` verschieben |
| `wrong_number` | Ungültige Nummer | Lead als verloren markieren oder Daten korrigieren |
| `interested` | Ja, aber noch Fragen | Termin buchen, Verfügbarkeit besprechen |
| `eligibility_unclear` | Bedarf Arbeitgeber-Auskunft | Task "Arbeitgeber kontaktieren" erstellen; in `employer_pending` |
| `employer_pending` | Admin prüft Betriebsnummer & Mitarbeiter | Warten; Parallel andere Leads bearbeiten |
| `qualified` | Qualifizierungsgespräch OK, 20h/6Mo bestätigt | Testphase vorbereiten, Task erstellen |
| `test_phase` | Eignungstest durchlaufen | Dokumentensammlung, Task "Dokumente hochladen" |
| `documents_phase` | Unterlagen eingereicht | BA-Antrag in Vorbereitung; Consultant füllt Formularfelder |
| `application_phase` | Antrag zu BA gesendet | Warten auf BA-Genehmigung (5–10 Arbeitstage) |
| `enrolled` | ✅ Bestätigt & im Programm | Abschluss; Lead ist ein **Erfolg** |
| `not_interested` | Ablehnung | Terminal; Grund in Notes protokollieren |
| `lost` | Abbruch (beliebiger Grund) | Terminal; Lead-Datensatz behält Verlauf für Analyse |

---

### 4.5 SLA-Signale und Aufmerksamkeits-Indikatoren

**Auto-Alerts (für Start des Tages):**

1. **Stale New (>7 Tage):** `created_at <= NOW() - INTERVAL 7 days AND status='new'`
   - → Filter-Link: Alle anzeigen, priorisieren
   - → Action: "3 Leads heute bearbeitet, oder in `lost` verschieben"

2. **Fehlende Telefon:** `phone_normalized IS NULL OR phone_normalized=''` für active leads
   - → Constraint: Egal welcher Status, ohne Telefon kann nicht angerufen werden
   - → Action: Lead-Detail aufrufen, Nummer hinzufügen oder `not_reachable` setzen

3. **Fehlende E-Mail:** `email IS NULL OR email=''` für interested+ leads
   - → Hinweis: E-Mail nötig für Magic-Links, Verträge
   - → Action: Vom Lead erfragen oder alternatives Zustellungsverfahren

4. **Employer Pending (>3 Tage):** `status='employer_pending' AND created_at <= NOW() - INTERVAL 3 days`
   - → Hinweis: Admin muss prüfen (ggf. Eskalation)

5. **Wrong Number:** `status='wrong_number'`
   - → Daten-Hygiene-Meldung: Korrigieren oder `lost` setzen

**Implementierung:** [`src/modules/participants/pipeline.ts:84–108`](../../src/modules/participants/pipeline.ts)

---

### 4.6 Datenqualitäts-Indikatoren

**Coverage (Kontaktierbarkeit):**
- Total Leads (im Filter): 42
- Mit Telefon: 38 (90%)
- Mit E-Mail: 35 (83%)
- Weder Telefon noch E-Mail: 2 (kritisch)

**Stale Data:**
- Stale `new` (>7 Tage): Alert-Zähler [`src/modules/participants/pipeline.ts:94`](../../src/modules/participants/pipeline.ts)
- Stale `called` (>X Tage): Kein definierter Alert-Schwellwert (Empfohlen: manuell prüfen bei Alter >14 Tage)
- Action: "Diese Leads heute überprüfen oder in `lost` verschieben"

**Implementierung:** [`src/modules/participants/pipeline.ts:43–108`](../../src/modules/participants/pipeline.ts)

---

## 5. Aufgaben-Workflow

### 5.1 Aufgabentypen und Kanäle

Ein **Task** ist eine Arbeit, die jemandem zugewiesen ist. Der Aufgabentyp bestimmt den Kanal (wie sie gesendet werden) und optionale Erinnerer.

**Task-Typen (Beispiele):**
- `call_lead`: Anruf-Aufgabe (Kanal: `internal`)
- `send_magic_link`: Lead-Dokumente hochladen (Kanal: `magic_link`)
- `schedule_appointment`: Termin vereinbaren (Kanal: `email` + `whatsapp`)
- `verify_employer_details`: Admin-Aufgabe (Kanal: `internal`)
- `send_ba_application`: BA-Antrag vorbereiten (Kanal: `internal`)

**Kanäle (Zustellungsoptionen):**
- `internal`: Über Konsolen-UI (für Berater, Admin)
- `email`: E-Mail an Consultant oder Lead
- `whatsapp`: WhatsApp-Nachricht (24h-Fenster nach Inbound)
- `magic_link`: Authentifizierter Link zum Portal (für externe Parteien)

**Status eines Tasks:**
- `open`: Gerade erstellt, noch nicht begonnen
- `in_progress`: Bearbeiter hat angefangen
- `waiting`: Bearbeiter wartet auf externe Antwort (z. B. Lead antwortet auf E-Mail)
- `done`: Abgeschlossen & erfolgreiche Bestätigung
- `escalated`: Übertragen an Manager (Zeit überschritten)
- `cancelled`: Abgebrochen (z. B. `not_interested` Statuswechsel macht Task obsolet)

**Spalten-Definition:** [`src/db/schema/tasks.ts:12–64`](../../src/db/schema/tasks.ts)

---

### 5.2 Task-Erstellen (automatisch via Routing-Engine)

Wenn ein Lead einen Statuswechsel durchläuft, werden neue Tasks automatisch erstellt, basierend auf den konfigurierten **Routing-Regeln**. Eine Regel enthält:

```
triggerEntity: "participant"
triggerStatus: "interested"  ← Wenn Lead zu "interested" wird…
active: true

taskConfig: {
  type: "schedule_appointment",
  title: "Termin mit ${firstName} vereinbaren",
  owner: "consultant",  ← Lead's aktueller Berater
  channel: "internal",
  dueAt: NOW() + 1 DAY,
  reminderPlan: [
    {afterHours: 24, channel: "email", templateKey: "task_reminder"},
    {afterHours: 48, channel: "internal", templateKey: "task_escalation"}
  ]
}
```

**Idempotenz:** Das System erstellt maximal **eine AKTIVE** Aufgabe pro (Tenant, TaskTyp, Owner, Subject). Wenn bereits eine offene Aufgabe für denselben Combo existiert, wird die neue ignoriert. Das verhindert Aufgaben-Verdoppelung bei gleichzeitigen Übergängen.

**Eindeutig-Beschränkung (DB-Level):** 
```sql
UNIQUE INDEX tasks_active_dedup_idx ON (
  tenant_id, type, owner_kind, 
  COALESCE(owner_participant_id, owner_employer_id, owner_user_id),
  subject_kind, subject_id
) WHERE status IN ('open', 'in_progress', 'waiting')
```

**Implementierung:** [`src/modules/routing/engine.ts:83–200`](../../src/modules/routing/engine.ts)

---

### 5.3 Task-Zuweisung

**Automatische Zuweisung (Routing-Engine):**
- `ownerKind`: Rulle (internal_user | participant | employer)
- `ownerUserId` / `ownerParticipantId` / `ownerEmployerId`: Konkrete Person/Entity

**Beispiel:**
```
Rule: "Call lead to collect employer details"
  ownerRole: internal_user
  ownerResolution: "current_consultant" ← Lead's assignedConsultantId
  → Task erstellt mit ownerUserId = <consultant UUID>
```

**Manuelle Neuzuweisung (Konsole):**
- Consultant kann die Aufgabe einer anderen Person zuweisen
- Admin kann alle Aufgaben neu zuweisen (Bulk-Operation)

---

### 5.4 Fälligkeitsdaten und Erinnerer

**Fälligkeitsdatum (`dueAt`):**
- Wird bei Task-Erstellung gesetzt (z. B. `NOW() + 1 DAY`)
- Berater sieht Warnung, wenn Fälligkeitsdatum überschritten
- Worker markiert überfällige Tasks als `escalated`

**Eskalation (`escalatedToUserId`):**
- Wenn Task `dueAt` überschritten & nicht abgeschlossen
- Task wird `escalated` und einem Manager zugewiesen
- Lead verliert keine Aufmerksamkeit

**Erinnerer (`reminderPlan`):**
```json
[
  {
    "afterHours": 24,
    "channel": "email",
    "templateKey": "task_reminder_24h"
  },
  {
    "afterHours": 48,
    "beforeHours": 2,
    "channel": "whatsapp",
    "templateKey": "appointment_reminder_2h_before"
  }
]
```

- `afterHours`: 24 Stunden nach Task-Erstellen
- `beforeHours`: 2 Stunden **vor** einem Termin-Datum (referenceAt)
- Reminders werden als separate `reminder_jobs` geplant

**Implementierung:** [`src/modules/routing/engine.ts:195–220`](../../src/modules/routing/engine.ts)

---

### 5.5 Fertigstellung, Abbruch und Revokation

**Task abschließen:**
1. Berater öffnet Aufgabe, klickt "Done"
2. UI zeigt Bestätigungsformular (z. B. "Termin auf Dienstag, 15:00 vereinbart?")
3. Task wird `done`, `completedAt` wird gesetzt
4. Audit-Eintrag erstellt

**Task abbrechen:**
1. Berater klickt "Cancel" (Grund im Modal eingeben)
2. Task wird `cancelled`, nicht versucht erneut zu erstellen
3. Useful für: "Lead ist nicht erreichbar, Task irrelevant geworden"

**Automatische Revokation (bei Statusänderung):**
- Wenn Lead zu `lost` wechselt, werden alle offenen Tasks für diesen Lead → `cancelled`
- Wenn Lead zu `not_interested` wechselt → ähnlich
- Exception: Tasks mit `subjectKind != 'participant'` bleiben offen (z. B. Admin-Aufgaben)

---

### 5.6 Link und Subjekt (Polymorphie)

Ein Task kann sich auf ein bestimmtes **Subjekt** beziehen (nicht nur den Owner):

```
Task {
  type: "collect_documents",
  ownerKind: "participant",
  ownerParticipantId: <lead UUID>,
  
  subjectKind: "appointment",       ← was ist das Thema?
  subjectId: <appointment UUID>,    ← mit Referenz
}
```

Das erlaubt Nachrichten wie: "Du hast eine Task, Dokumente zum Termin am Mittwoch hochzuladen"

Andere `subjectKind`-Werte:
- `application` (BA-Antrag)
- `aptitude_test` (Eignungstest)
- `document` (Einzeldokument)
- `null` (Keine Bezugnahme, generische Task)

**Implementierung:** [`src/db/schema/tasks.ts:31–33`](../../src/db/schema/tasks.ts)

---

### 5.7 Deduplizierung und Idempotenz

**Szenario:** Zwei Status-Übergänge feuern gleichzeitig (Rasse-Bedingung)

```
Lead transitions: qualified → test_phase  (Consultant klickt, DB-Schreibvorgang lädt…)
Gleichzeitig: Testphase Auto-Übergang (Job startet)
  
→ Beide Übergänge versuchen, die gleiche Task zu erstellen:
   type="test_phase_reminder", owner=consultant, subject=<lead>
   
→ Eindeutig-Index auf DB verhindert 2. Einfügung (UNIQUE CONSTRAINT)
→ Zweiter Try wertet zu "Task bereits offen" aus
→ Keine Duplikate
```

**Sicherheit:**
- App-Level: Engine prüft vor Einfügung (W1.2)
- DB-Level: Eindeutiger Partial-Index schließt Race

---

### 5.8 Magic-Links und externe Zugriffe

**Wenn ein Task einen externen Adressaten hat** (z. B. Lead muss Dokumente hochladen):

1. **Magic-Link wird erzeugt:** [`src/modules/tokens/service.ts:getOrIssueMagicLinkForTask()`](../../src/modules/tokens/service.ts)
   - Token wird signiert & zeitgebunden (z. B. 30 Tage gültig)
   - Speichern in `tokens` Tabelle mit `linkedEntityKind='task'`, `linkedEntityId=<taskId>`

2. **Nachricht gesendet:** E-Mail oder WhatsApp mit Link
   - Link: `https://app.example.com/t/<TOKEN_SIGNED>`
   - Lead klickt, wird per Token authentifiziert (kein Login nötig)
   - Portal öffnet mit Task-Details & Aktions-Form

3. **Token-TTL und Gültigkeit:**
- Standard-TTL: **7 Tage** (DEFAULT_MAGIC_LINK_TTL_HOURS = 7*24, konfigurierbar via `MAGIC_LINK_TTL_HOURS` in env)
- Minimum: 1 Stunde (MIN_MAGIC_LINK_TTL_HOURS = 1)
- Maximum: 30 Tage (MAX_MAGIC_LINK_TTL_HOURS = 30*24)
- Jeder TTL-Wert wird automatisch in diese Spanne geklemmt (clamped)
- Token-Neuausstellung (re-issue): Erzeugt einen neuen Token & revoziert den alten; die TTL wird zurückgesetzt

**Token-Gültigkeitsprüfung:**
- Token muss `expiresAt > NOW()` sein
- Token muss auf ein AKTIVES Task zeigen (`status IN ('open', 'in_progress', 'waiting')`)
- Scopes mit Multi-Use (`start_aptitude_test`, `employer_setup`, …): Task-Status wird nicht geprüft (beabsichtigte Re-Entry)
- Wenn Task → `cancelled` oder `done`, wird Token unwirksam (außer Multi-Use-Scopes)

**Tokenneuausstellung (implementiert):**
- **UI-Kontrolle:** "Link erzeugen" Button in der Aufgaben-Konsole ([`src/app/(internal)/tasks/page.tsx:165–181`](../../src/app/(internal)/tasks/page.tsx))
- **Beschreibung:** Authentifizierte interne Benutzer (nicht admin-only) können für Tasks mit externem Owner einen neuen Magic-Link erzeugen
- **Funktion:** [`src/modules/tasks/actions.ts:29–50`](../../src/modules/tasks/actions.ts) ruft `getOrIssueMagicLinkForTask()` auf
- **Verhalten:** Reuses einen gültigen aktuellen Link oder erzeugt einen frischen Token & revoziert alte ungenutzten Tokens
- **TTL-Konfiguration:** [`src/modules/tokens/policy.ts:11–43`](../../src/modules/tokens/policy.ts)
- **Voraussetzungen:** Task muss eligibel sein (Status aktiv, Token-Service-Prüfungen erfolgreich; revoked/inactive Tasks liefern keine nutzbaren Links)

---

## Häufige Fehler und Sicherheitsmaßnahmen

### Fehler 1: Zu schnelle Statusübergänge
**Problem:** "Consultant markiert Lead zu schnell als `qualified`, ohne Verfügbarkeit zu klären"  
**System-Schutz:** `AvailabilityGateError` blockiert Übergang  
**Behebung:** Task "Verfügbarkeit erfragen" wird erzeugt, Lead antwortet; dann Übergang möglich

### Fehler 2: Doppelte Aufgaben (Idempotenz-Rasse)
**Problem:** "Zwei gleichzeitige Status-Übergänge versuchen, die gleiche Task zu erstellen"  
**System-Schutz:** Eindeutig-Index (tasks_active_dedup_idx) verhindert 2. Einfügung; App-Level-Prüfung vor Einfügung (W1.2)  
**Resultat:** Zweiter Übergang-Versuch erkennt, dass Task bereits offen ist, überspringt Duplikat harmlos

### Fehler 3: Beschädigte Audit-Spur bei Undo
**Problem:** "Admin macht Undo (zurück zu `new`), Task-Kette wird nicht rückgängig gemacht"  
**Verhalten (implementiert):** Undo (`undoLastAction`, Ctrl/Cmd+Z) revertiert die Spalte auf den vorherigen Wert (oder Default), hebt Tasks auf, die **in der gleichen Transaktion** erstellt wurden. Das Routing-Engine wird NICHT erneut ausgeführt, also keine neuen Tasks für den revert-to-Status.  
**Live Task-Cleanup:** Tasks mit Zustand `{open, in_progress, waiting, escalated}` werden `cancelled`; `done` Tasks bleiben unangerührt  
**Best Practice:** Manuell nach Undo prüfen, falls externe Aktionen bereits stattfanden

### Fehler 4: Lead bleibt in `employer_pending` stecken
**Problem:** "Admin hat Arbeitgeber-Prüfung vergessen, Lead sitzt wochenlang fest"  
**System-Schutz:** Alert auf Pipeline zählt `employerPending`-Leads. Empfohlener Schwellwert: 3+ Tage ohne Bearbeitung  
**Implementierung:** `getPipelineAlerts()` [`src/modules/participants/pipeline.ts:84–108`](../../src/modules/participants/pipeline.ts)  
**Behebung:** Admin-Filter: Status=`employer_pending`, sortiert nach "Erstellt", von oben nach unten abarbeiten

### Fehler 5: Magic-Link abgelaufen oder ungültig
**Problem:** "Lead klickt auf Link in E-Mail, aber es ist älter als die konfigurierte TTL (Standard: 7 Tage) → 'Token ungültig'"  
**Symptome:** 
- Token-Ablauf (expiresAt <= NOW())
- Task ist nicht mehr aktiv (status ∉ {open, in_progress, waiting}, außer Multi-Use-Scopes)
- Token wurde revoziert (widerrufen)
- Task wird nicht erkannt (ungültige Task-ID)

**Behebung:** Consultant öffnet die Aufgaben-Konsole ([`src/app/(internal)/tasks/page.tsx`](../../src/app/(internal)/tasks/page.tsx)), sucht das Task und klickt "Link erzeugen", um einen neuen Magic-Link zu erzeugen. Der neue Token reuset den alten (falls gültig) oder erzeugt einen frischen und revoziert alte ungenutzten Tokens.

---

## Anhang: Datenbankstruktur (für Administratoren)

### Wichtige Indizes

```sql
-- Pipeline-Filterung (Status, Consultant, Datum)
INDEX participants_pipeline_idx (tenant_id, status, assigned_consultant_id, created_at)

-- Deduplizierung von Register-Importen
UNIQUE INDEX participants_tenant_register_idx 
  (tenant_id, register_id) 
  WHERE register_id IS NOT NULL

-- Task-Idempotenz (verhindert Duplikate)
UNIQUE INDEX tasks_active_dedup_idx 
  (tenant_id, type, owner_kind, 
   COALESCE(owner_participant_id, owner_employer_id, owner_user_id),
   subject_kind, subject_id) 
  WHERE status IN ('open', 'in_progress', 'waiting')
```

### Kritische Spalten

| Tabelle | Spalte | Einschränkung | Auswirkung |
|---------|--------|---------------|------------|
| `participants` | `status` | ENUM | Nur erlaubte Werte |
| `participants` | `available_status` | ENUM | Nicht NULL (Default: 'unclear') |
| `participants` | `register_id` | Text, Unique (Partial) | Doppelimporte pro Tenant verhindert |
| `tasks` | `status` | ENUM | Nur erlaubte Werte |
| `tasks` | `owner_kind` + owner_*_id | CHECK | Genau einer ist non-NULL |
| `import_runs` | `status` | ENUM | Audit-Pfad für Fehler |

---

## Kontakt und Support

Für Fragen, Bug-Reports oder Admin-Zugang-Anforderungen wenden Sie sich an den Systemadministrator oder den technischen Support Ihrer Organisation. Die Kontaktinformationen werden durch Ihre Organisations-Konfiguration bereitgestellt.

---

**Versionsverlauf:**
- 2026-07-28: Initial version (Kapitel 2, alle 5 Hauptsektionen)
- 2026-07-28: Codemaps hinzugefügt, Transition Tests verifiziert, Register-Import dokumentiert
- 2026-07-28: Factual validation corrections: Magic-link TTL (7 days default, configurable 1h–30d), removed invented support addresses, corrected Undo semantics, clarified call script UI (6 actual buttons), marked morning-brief as planned, fixed stale-data thresholds (only 7-day for new, no 14-day threshold)
