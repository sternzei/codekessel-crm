# BA eService: Antragstellung §82 SGB III (QCG)

Stand: Juli 2026. Quelle: eigene Antragsdurchläufe (Screenshots in `AZAV/`),
BA-Formulare in `../Antragsdokumente/` bzw. `templates/pdf/`.

**Kernerkenntnis:** Die Einreichung läuft über den BA eService
(`web.arbeitsagentur.de/aezo`). Das große AEZ-Antragsformular (ba042359, 149
Felder) **entfällt** — dieselben Angaben werden online eingegeben. PDFs werden
nur noch **hochgeladen**, wo der eService es verlangt. Login: BA-Konto oder
Unternehmenskonto (ELSTER).

## Zwei Antragswege, gleicher Dokumentenpool

| | Einzelantrag | Sammelantrag (Firma) |
|---|---|---|
| eService | "Arbeitsentgeltzuschuss – Antrag" | "Sammelantrag – AEZ und Weiterbildungskosten" |
| Schritte | 6 | 7 |
| Personen | 1 beschäftigte Person | mehrere Beschäftigte desselben Betriebs |
| `applications.applicant_type` | `single` | `company` |

### Einzelantrag — 6 Schritte (Screenshots: `AZAV/Single - Page1..6.pdf`)

1. **Allgemeine Angaben:** Betrieb (Name, Betriebsnummer, Anschrift),
   Ansprechperson, IBAN Geschäftskonto.
2. **Betriebsgröße:** Beschäftigte nach Wochenstunden-Faktoren (0,25/0,5/0,75/1),
   Betriebsvereinbarung/Tarifvertrag (+5 % Fördersatz).
3. **Weiterbildung:** Bildungsträger, Bezeichnung, AZAV-Zulassung, >120 h,
   Inhalte über Anpassungsfortbildung hinaus, Berufsabschluss, Verpflichtung,
   Beginn/Ende, Umfang, Schulungszeiten (Uhrzeiten je Wochentag).
   → **Upload: Trägerbescheinigung** (ba042369) — wird von uns generiert.
4. **Beschäftigte Person:** Name, Geburtsdatum, SV-Arbeitsverhältnis besteht
   fort, vertragliche Arbeitszeit + Verteilung, Arbeitszeitrahmen (Uhrzeiten),
   Freistellungsstunden, Gehalt (Gesamt oder Grund+Bestandteile;
   tariflich/ortsüblich/frei), Entgeltänderungen, KuG/EGZ/anderer Zuschuss.
5. **Daten überprüfen.**
6. **Zustimmung:** 3 Pflicht-Checkboxen + Anmerkungen (1000 Zeichen).

### Sammelantrag — 7 Schritte (Screenshots: `AZAV/Multiple - Page1..7.pdf`)

1. **Allgemeine Angaben** (Betrieb).
2. **Weiterbildung** → **Upload: Nachweis der Lehrgangskosten** (unsere
   Kostenübersicht).
3. **Zulassung** → **Upload: Träger- und Maßnahmezertifikat**
   (`templates/documents/zertifikat-traeger_Z-000978.pdf`,
   `zertifikat-massnahme_Z-001270.pdf`).
4. **Beschäftigtenliste** → **Upload: Anlage zum Sammelantrag – Liste der
   Teilnehmenden** (BA I FW 501/502, 325 Felder, max. 18 Personen) — wird von
   uns generiert (`teilnehmerliste`).
5. Weitere Angaben (Arbeitszeit/Entgelt, Teil 2 der Liste).
6. **Daten überprüfen.**
7. **Zustimmung.**

## Formulare in `templates/pdf/` und ihr Status

| Datei | BA-Nr. | Rolle | Autofill |
|---|---|---|---|
| `traegerbescheinigung_ba042369.pdf` | AEZ 4 | Träger füllt + unterschreibt; Upload Einzelantrag Schritt 3 | ✅ vollständig (`buildTraegerbescheinigungValues`, 15 Felder, verifiziert gegen echtes Beispiel `AZAV/Page3.pdf`) |
| `sammelantrag-teilnehmerliste_ba501-502.pdf` | BA I FW 501/502 | Upload Sammelantrag Schritt 4 | ✅ Kopf + Teilnehmerzeilen (SV-Nummern fehlen zentral → leer) |
| `vollmacht_ba051211.pdf` | — | Teilnehmer:in unterschreibt; nötig für AG-S-Beratung | ⬜ Mapping offen (42 Felder) |
| `arbeitnehmererklaerung_ba042354.pdf` | AEZ 2 | Teilnehmer:in füllt + unterschreibt; Upload | ⬜ Mapping offen (16 Felder) |
| `fragebogen_ba046157.pdf` | — | Teilnehmer:in; ergänzend | ⬜ Mapping offen (190 Felder) |
| `schlusserklaerung_ba042364.pdf` | AEZ 3 | nach Maßnahmenende; entfällt bei eService-Antrag | ⬜ Mapping offen (112 Felder) |

Neue Mappings: Felder mit `pypdf`/`pdf-lib` auslesen, Builder in
`src/modules/documents/ba-forms.ts` ergänzen, `DOC_TYPES` in
`src/modules/documents/actions.ts` registrieren.

## Bekannte Datenlücken (Gesamtübersicht-PDF vs. Schema)

Noch nicht zentral erfasst und daher im Begleitblatt als "—" markiert:
SV-Nummer, IBAN/BIC (Betrieb + Person), Gehaltsdaten, Arbeitszeitrahmen und
Schulungszeiten (Uhrzeiten je Wochentag), Freistellungsstunden,
Betriebsvereinbarung/Tarifvertrag, Beschäftigtenzahlen nach Stunden-Faktoren,
Berufsabschluss-Historie, KuG/EGZ-Status. → Kandidaten für die nächsten
Erfassungs-Flows (Magic-Link-Formulare für Person bzw. Arbeitgeber).

## Migration

`applications.applicant_type` wurde dem Schema hinzugefügt. Einmalig:

```bash
pnpm db:generate && pnpm db:migrate
```
