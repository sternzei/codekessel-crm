# Live-Test-Leitfaden

Wie man die Plattform startet, wer was darf und wie ein Fall von der ersten
Telefonnummer bis zur Bewilligung durchläuft. Geschrieben für einen begleiteten
Testtag mit echten Personen am Telefon.

Zwei Dinge vorab, weil sie den ganzen Tag prägen:

- **`pnpm db:seed` löscht die komplette Datenbank** (alle Mandanten, Benutzer,
  Teilnehmenden) und legt die Demo-Daten neu an. Auf einer Datenbank mit echten
  Daten darf der Befehl nie laufen.
- **Ohne WhatsApp-Zugangsdaten verschickt das System keine WhatsApp-Nachrichten.**
  Der Adapter läuft dann im Mock-Modus: die Aufgabe wird angelegt, der Link
  erzeugt, die Nachricht als „gesendet" protokolliert — beim Empfänger kommt
  nichts an. Für den Testtag gilt deshalb: **Links immer manuell aus
  „Aufgaben" kopieren und selbst versenden** (siehe [Nachrichten](#nachrichten-was-heute-wirklich-rausgeht)).

---

## 1. Setup

### 1.1 Lokal (Entwicklungsmaschine, für den Trockenlauf)

```bash
# 1. Abhängigkeiten
pnpm install

# 2. Postgres starten (Docker)
docker compose up -d db

# 3. Umgebung anlegen
cp .env.example .env.local     # danach Werte setzen, siehe 1.3

# 4. Schema + Demo-Daten
pnpm db:migrate
pnpm db:seed                   # ACHTUNG: löscht alles

# 5. App + Hintergrund-Worker (zwei Terminals)
pnpm dev
pnpm jobs:dev                  # Erinnerungen, Eskalationen, Outbox
```

App: <http://localhost:3000> · Anmeldung siehe [1.5](#15-demo-zugänge).

### 1.2 Server (der Testtag selbst)

```bash
docker compose up -d           # web + worker + db
docker compose exec web pnpm db:migrate
```

Danach prüfen:

```bash
curl -s https://<host>/api/health   # {"status":"ok"} – lebt der Prozess
curl -s https://<host>/api/ready    # prüft DB, Storage, Worker-Rückstand, Outbox
```

`/api/ready` liefert `503`, sobald eine Prüfung `failed` oder `degraded` ist.
Der Worker-Check schlägt erst an, wenn eine fällige Erinnerung länger als fünf
Minuten liegen bleibt — ein gestoppter Worker fällt also nicht sofort auf.
Vor dem Testtag einmal bewusst kontrollieren, dass der Worker-Container läuft.

### 1.3 Pflicht-Konfiguration

Ohne diese Werte startet die App in Produktion gar nicht (`src/lib/env.ts`
validiert beim Start und bricht mit einer klaren Meldung ab):

| Variable | Warum |
|---|---|
| `DATABASE_URL` | App-Verbindung (RLS-Rolle `qcg_app`) |
| `MIGRATION_DATABASE_URL` | Migrationen + Seed (Tabellen-Owner) |
| `AUTH_SECRET` | Sitzungs-Cookies · ≥32 Zeichen, kein Platzhalter |
| `TOKEN_SECRET` | Magic-Link-Signatur · ≥32 Zeichen, ungleich `AUTH_SECRET` |
| `APP_BASE_URL` | steht in jedem Magic Link · öffentliches HTTPS |
| `STORAGE_DRIVER=db` | Uploads und PDFs liegen in Postgres |
| `TRUST_PROXY=true` | hinter Reverse Proxy, sonst greift das Login-Rate-Limit falsch |
| `LEGAL_PROVIDER_NAME` | Impressum (§5 DDG) |
| `LEGAL_PROVIDER_ADDRESS` | Impressum · Zeilen mit `\n` trennen |
| `LEGAL_PROVIDER_EMAIL` | Impressum + Datenschutzerklärung |

Secrets erzeugen: `openssl rand -base64 48`.

Optional, aber für einen echten Testtag relevant:

| Variable | Wirkung wenn gesetzt | Wirkung wenn leer |
|---|---|---|
| `RESEND_API_KEY` + `RESEND_FROM_EMAIL` | E-Mails gehen wirklich raus | Mock: nur Logzeile |
| `WHATSAPP_ACCESS_TOKEN` + `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp geht wirklich raus | automatische Nachrichten weichen auf E-Mail aus, sofern eine Adresse vorliegt und Resend konfiguriert ist |
| `APTITUDE_TEST_BASE_URL` | „Test starten" führt zum echten Testanbieter | Einladung wird verweigert (Hinweis am Lead), damit niemand einen Link ins Leere bekommt |
| `OPENREGISTER_API_KEY` | Register-Import sucht echte Firmen (kostet Credits) | Mock-Firmen |
| `ERROR_WEBHOOK_URL` | Server-Fehler landen im Monitoring | nur stdout |
| `MAGIC_LINK_TTL_HOURS` | Gültigkeit der Teilnehmer-Links (Standard 168 h) | 7 Tage |
| `PROVIDER_NAME` | Trägername im BA-Fragebogen | `codeKessel Inh. Ugur Karatas` |
| `PROVIDER_CITY` | Ort auf der Trägerbescheinigung | `Böblingen` |

`PROVIDER_NAME` und `PROVIDER_CITY` werden direkt aus `process.env` gelesen und
nicht validiert — stimmen die Vorgaben nicht, steht der falsche Träger auf
einem BA-Formular. Umgekehrt setzt `docker-compose.yml` für
`LEGAL_PROVIDER_NAME` den Vorgabewert `QCG Demo GmbH`: ohne eigene `.env` steht
im Impressum eine Firma, die es nicht gibt.

### 1.4 Mandant und erster Benutzer

Für einen **echten** Mandanten gibt es `pnpm bootstrap:tenant`. Das Skript legt
die vier Dinge an, ohne die die App zwar läuft, aber nichts tut — Mandant,
ersten Admin, die ~25 Routing-Regeln und den Vorlagenkatalog — und **löscht
nichts**. Ein erneuter Lauf ergänzt nur, was fehlt:

```bash
TENANT_NAME="Muster Bildungsträger GmbH" \
ADMIN_EMAIL="leitung@traeger.de" \
ADMIN_NAME="Vorname Nachname" \
ADMIN_PASSWORD="<mindestens 12 Zeichen>" \
MEASURE_NAME="<Kursname>" MEASURE_AZAV_NUMBER="<AZAV-Nr.>" \
MEASURE_START_DATE="2026-09-01" MEASURE_COST_EUR="8900.00" \
  pnpm bootstrap:tenant
```

Ein vorhandenes Admin-Konto wird bewusst nicht überschrieben; ein Passwort
setzt man in der Oberfläche unter **Benutzer** zurück. Alle weiteren Konten
entstehen ebenfalls dort.

`pnpm db:seed` ist das Gegenteil davon: eine Demo-Vorrichtung, die **jede Zeile
löscht** und die `@demo.de`-Konten neu schreibt. Auf einer Datenbank mit echten
Daten also niemals ausführen.

Für **Maßnahmen** gibt es keine Oberfläche. Die erste legt der Bootstrap über
die `MEASURE_*`-Variablen an, weitere per SQL (`insert into measures (tenant_id,
name, azav_number, duration_weeks, weekly_hours, format, cost_eur, start_date)
…`). Ohne passende Maßnahme kann die Beratung einen Lead nicht vollständig
qualifizieren, weil Antrag und Dokumente eine Maßnahme voraussetzen.

### 1.5 Demo-Zugänge

| E-Mail | Rolle | Passwort |
|---|---|---|
| `admin@demo.de` | Administration | `demo1234` |
| `leitung@demo.de` | Teamleitung | `demo1234` |
| `berater@demo.de` | Beratung | `demo1234` |

`pnpm db:seed` gibt am Ende vier funktionierende Magic Links aus
(Verfügbarkeit, Kontaktdaten, Arbeitgeber-Setup, Eignungstest) — praktisch, um
die Teilnehmer- und Arbeitgeberansicht ohne Umweg zu zeigen.

---

## 2. Rollen

| | Beratung | Teamleitung | Administration |
|---|---|---|---|
| Pipeline | eigene + nicht zugewiesene Leads | alle | alle |
| Lead bearbeiten | nur nach „Lead übernehmen" | alle | alle |
| Leads zuweisen | nur an sich selbst | beliebig | beliebig |
| Aufgaben | eigene + Teilnehmer-Aufgaben; **Arbeitgeber-Aufgaben unsichtbar** | alle | alle |
| Postausgang freigeben | nein (nur ansehen) | ja | ja |
| Arbeitgeber-Setup-Link | **nein** (Knopf wird nicht angezeigt) | ja | ja |
| Berichte | nur eigene Zahlen | mandantenweit | mandantenweit |
| Benutzer | nein | ja (keine Admins) | ja |
| Register-Import | nein | nein | ja |

Zwei Sperren, die im Test auffallen werden und so gewollt sind: niemand ändert
die eigene Rolle oder deaktiviert sich selbst, und die Teamleitung kann
Administrationskonten weder anlegen noch ändern.

---

## 3. Der Ablauf eines Falls

### 3.1 Erstkontakt (Beratung)

1. **Pipeline → „+ Neuer Lead"**: Vorname, Nachname, Telefon, E-Mail, Ort,
   Quelle. Der Lead gehört danach der anlegenden Person und steht auf
   „Neuer Lead".
2. Lead öffnen. Der **Gesprächsleitfaden Erstkontakt** enthält die
   Gesprächsführung und die Ergebnis-Knöpfe: *Interessiert*, *Kein Interesse*,
   *Nicht erreichbar*, *Falsche Nummer*.
3. Jedes Ergebnis löst Automatik aus: „Falsche Nummer" erzeugt eine
   Teilnehmer-Aufgabe „Korrekte Kontaktdaten angeben" samt Link, „Nicht
   erreichbar" eine interne Wiedervorlage.
4. **Notiz speichern** hält Gesprächsinhalte fest; alles landet zusätzlich im
   **Verlauf** am Ende der Seite.

### 3.2 Förderprüfung und Verfügbarkeit

5. **Fördervoraussetzungen**: Arbeitgeber, Maßnahme, Beschäftigungsstatus.
6. **Pflicht-Check Verfügbarkeit**: 20 Std./Woche über ~6 Monate. Diese Antwort
   ist ein hartes Tor — ohne ein klares „Ja" lässt sich der Lead nicht
   qualifizieren, und der Versuch endet in einem roten Hinweisbanner.
   Die Antwort kann die Beratung erfassen oder der Teilnehmende selbst über
   den Verfügbarkeits-Link.
7. **Status ändern → Qualifiziert.** Ab hier ist der Weg linear:
   Qualifiziert → Eignungstest → Dokumente → Antrag → Eingeschrieben.

### 3.3 Termin und Eignungstest

8. **Termin planen** setzt Erinnerungen (24 h und 2 h vorher an den
   Teilnehmenden, 1 h vorher intern als Anruf-Aufgabe).
9. Erscheint jemand nicht: unter **Termine** auf „No-Show" — das erzeugt
   automatisch einen Neuterminierungs-Link für den Teilnehmenden und eine
   interne Nachfass-Aufgabe.
10. **„Zum Eignungstest einladen"** legt Aufgabe und Link an. Ergebnis danach
    im Lead mit *Bestanden* / *Nicht bestanden* / *Nicht erschienen* erfassen;
    „Bestanden" erzeugt die interne Aufgabe „Antragsunterlagen vorbereiten".

### 3.4 Arbeitgeber (läuft parallel)

11. **Arbeitgeber → „Setup-Link erzeugen"** (nur Teamleitung/Administration).
12. Der Arbeitgeber füllt einen fünfstufigen Assistenten aus: Betriebsnummer,
    AG-S-Registrierung, Ansprechperson, Zeitmodell, Firmendaten (Rechtsform,
    IBAN, Betriebsvereinbarung, Personalstruktur). Zwischenspeichern ist
    möglich — der Link bleibt gültig, bis alles vollständig ist.
13. Der Status leitet sich daraus ab: Betriebsnummer fehlt → AG-S unklar →
    Zeitmodell offen → in Arbeit → **Bestätigt**.

### 3.5 Dokumente und Unterschriften

14. **Dokumente → Person wählen.** Verfügbar sind die echten BA-Formulare
    (Trägerbescheinigung, Arbeitnehmererklärung, Vollmacht, Fragebogen,
    Teilnehmerliste) sowie Hilfsdokumente (Lehrgangskosten-Nachweis,
    Stammblatt, Arbeitgeber-Datenblatt).
15. Fehlen Pflichtdaten, entsteht das Dokument mit dem Vermerk „Daten fehlen"
    plus einer Klärungsaufgabe — das ist Absicht, kein Fehler.
16. **„Signatur: Teilnehmer:in"** erzeugt eine Unterschriftsaufgabe. Den Link
    unter **Aufgaben** mit „Link erzeugen" holen und versenden. Der
    Unterzeichnende sieht das PDF, tippt seinen Namen, zeichnet die
    Unterschrift und bestätigt. Danach liegen signiertes PDF und
    Unterschriften-Nachweis (Zeitstempel, IP, SHA-256) im Dossier.

### 3.6 Antrag

17. Auf der Dokumentenseite **„Einzelantrag anlegen"** (oder Sammelantrag für
    eine Firma).
18. **Anträge → „Als vollständig markieren".** Das geht nur, wenn die
    Bereitschaftsprüfung durchläuft: Einwilligung liegt vor, Betriebsnummer
    ist da, das Upload-Set ist vollständig und unterschrieben. Fehlt etwas,
    steht der Grund in der Zeile.
19. **„Antragspaket exportieren"** legt ein zusammengeführtes PDF aller
    Unterlagen an. Es erscheint **nicht** als Download, sondern als neues
    Dokument unter **Dokumente** („Antragspaket (n Dokumente)").
20. **„An Arbeitgeber senden"** erzeugt die Arbeitgeber-Aufgabe „Einreichung
    bestätigen". Der Arbeitgeber bestätigt über seinen Link, dass er beim
    Arbeitgeberservice eingereicht hat → Status „Eingereicht".
21. Kommt der Bescheid: **Bewilligt** / **Abgelehnt** / **Korrektur nötig**.
    „Bewilligt" setzt den Teilnehmenden automatisch auf **Eingeschrieben**.

---

## 4. Nachrichten: was heute wirklich rausgeht

Der Kanal wird pro Aufgabe bestimmt: Teilnehmer- und Arbeitgeber-Aufgaben mit
Link gehen per WhatsApp, wenn eine Telefonnummer hinterlegt ist, sonst per
E-Mail.

| Konfiguration | WhatsApp-Empfänger | E-Mail-Empfänger |
|---|---|---|
| nichts gesetzt | bekommt **nichts** (Mock) | bekommt **nichts** (Mock) |
| nur Resend gesetzt | bekommt **nichts** | bekommt die E-Mail |
| beides gesetzt | bekommt die Nachricht | bekommt die E-Mail |

Solange WhatsApp nicht konfiguriert ist, ist der verlässliche Weg der manuelle:
**Aufgaben → „Link erzeugen" → Link kopieren → selbst per WhatsApp/E-Mail
schicken.** Für Teilnehmende mit Telefonnummer bietet die Aufgabenliste
zusätzlich einen Klick-zu-Chat-Knopf, der WhatsApp mit vorbereitetem Text
öffnet.

Der **Postausgang** bleibt im Normalbetrieb leer. Die Freigabeschleife ist
gebaut (Freigeben / Ablehnen, nur Teamleitung und Administration, keine
Selbstfreigabe), aber kein Pfad legt heute Nachrichten zur Freigabe ab:
Routing, Erinnerungs-Worker und der manuelle WhatsApp-Versand senden alle
sofort. Es gibt also **keine menschliche Kontrolle vor dem Versand** — wer das
für den Testtag will, versendet ausschließlich manuell über kopierte Links.

---

## 5. Ablauf für den Testtag

**Vorbereitung (Vortag)**

1. Migrationen einspielen, seeden, Demo-Daten wie in [1.4](#14-mandant-und-erster-benutzer) auf echte Werte ziehen.
2. `/api/ready` prüfen, Worker-Prozess sichtbar laufen lassen.
3. Zwei echte Testpersonen (eine Teilnehmerin, ein Arbeitgeber) einplanen, die
   Links auf dem Handy öffnen — die externen Seiten sind für Mobil gebaut.
4. Je Rolle ein Konto bereitlegen und einmal anmelden.

**Durchlauf (empfohlene Reihenfolge, ca. 90 Minuten)**

| # | Rolle | Schritt | Erwartung |
|---|---|---|---|
| 1 | Beratung | Lead anlegen, Gespräch führen, Ergebnis erfassen | Status wechselt, Verlauf füllt sich |
| 2 | Beratung | Verfügbarkeit ohne „Ja" → qualifizieren | rotes Banner, Status bleibt |
| 3 | Teilnehmer | Verfügbarkeits-Link am Handy → „Ja" | Danke-Seite, interne Folgeaufgabe |
| 4 | Beratung | qualifizieren, Termin planen, Test einladen | Aufgaben + Links entstehen |
| 5 | Teamleitung | Arbeitgeber-Setup-Link erzeugen | Link kopierbar |
| 6 | Arbeitgeber | Assistent ausfüllen | Status wird „Bestätigt" |
| 7 | Beratung | Einwilligungs- und Upload-Link erzeugen | Teilnehmer lädt Datei hoch |
| 8 | Teamleitung | BA-Formulare erzeugen, Signatur anfordern | „Daten fehlen" nur wo erwartet |
| 9 | Teilnehmer | Dokument unterschreiben | signiertes PDF + Nachweis |
| 10 | Teamleitung | Antrag anlegen → vollständig → senden | Bereitschaftsprüfung greift |
| 11 | Arbeitgeber | Einreichung bestätigen | Status „Eingereicht" |
| 12 | Teamleitung | „Bewilligt" | Teilnehmer „Eingeschrieben" |
| 13 | alle | Berichte ansehen | Trichter zeigt den Durchlauf |

**Beobachten und notieren**

- Jede Seite, auf der „Etwas ist schiefgelaufen" erscheint: die
  Support-Referenz aus der Fehlerseite mitschreiben, damit die Logzeile
  auffindbar ist.
- Alles, was ein Teilnehmender oder Arbeitgeber laut vorliest und nicht
  versteht — die externen Texte sind das Produkt.

---

## 6. Bekannte Grenzen am Testtag

| Thema | Stand |
|---|---|
| WhatsApp | nicht angebunden. Automatische Nachrichten gehen stattdessen per E-Mail raus, wenn Resend konfiguriert ist und eine Adresse vorliegt; sonst steht im Verlauf „Simulation — kein echter Versand". Der WhatsApp-Knopf am Vorgang öffnet weiterhin nur den Chat-Entwurf. |
| Eignungstest | ohne `APTITUDE_TEST_BASE_URL` verweigert die Einladung den Versand statt einen Platzhalter-Link zu verschicken |
| Namen mit Sonderzeichen | behoben: PDFs verwenden eine eingebettete Unicode-Schrift (türkisch, polnisch, kyrillisch). Arabisch/CJK bleiben leer statt zu scheitern |
| Antragspaket-Export | funktioniert; das Paket landet unter „Dokumente", ein Banner verlinkt das PDF |
| Erinnerungen | nur wenn der Worker läuft |
| Postausgang | bleibt leer; es gibt keine Freigabe vor dem Versand |
| Maßnahmen | erste per `bootstrap:tenant`, weitere nur per SQL |

Der aktuelle Stand dieser Punkte steht in `docs/PRODUCTION-READINESS.md`.
