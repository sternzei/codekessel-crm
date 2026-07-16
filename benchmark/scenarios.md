# QCG Platform — Benchmark Scenarios (click-by-click)

> Local benchmark spec (gitignored). Each scenario is a **runnable walkthrough**:
> log in, click here, do that, and check the exact expected result. Use it as a
> manual regression suite and as the acceptance spec for the next increment.
>
> Planned ghost data fixture (fictional, safe for demos/legal):
> `benchmark/ghost-company.md` (not checked in yet).
> Real BA forms, when available locally, are benchmarked against:
> `../Antragsdokumente/` (7 PDFs, 535 fields).
>
> **Legend:** 🟢 passes today · 🔴 fails today (open work) · 🟡 partial

---

## 0. Before you start (do this once)

```bash
pnpm install
cp .env.example .env.local
docker compose up -d                 # Postgres 16 on localhost:5433
pnpm db:migrate && pnpm db:seed      # schema + RLS + demo data (prints 4 magic links)
pnpm dev                             # http://localhost:3000
pnpm jobs:dev                        # SECOND terminal — reminder/escalation worker
```

**Logins (internal console — http://localhost:3000/auth/sign-in):**
- Admin: `admin@demo.de` / `demo1234`
- Consultant: `berater@demo.de` / `demo1234`

**Nav (top of console after login):** Pipeline · Aufgaben · Termine · Arbeitgeber · Dokumente · Anträge · Berichte

**Seed cast:**
- Participants: Lena Hoffmann, Tarek Aziz, Sofia Ricci, Ole Janssen, Deniz, Jonas Petersen (+ Marta, Aylin, Viktor, Fatima).
- Employers: **Nordbau GmbH** (complete) · **PflegePlus Sozialdienste eG** (Betriebsnummer missing) · **City Logistik KG** (time model pending) · **BüroTec Service GmbH** (incomplete).
- Links in `/t/[token]/…` are usually **single-use on successful submit** — opening a link does not burn it. Re-mint from **Aufgaben → "Link erzeugen"** or re-seed. Exception: the aptitude-test start link deliberately stays reusable so the participant can return to the test launcher.

> After each scenario that completes a magic-link task, either mint a fresh one or run `pnpm db:reset` to start clean.

---

## BM-1 🟢 — The unreachable lead recovers itself

**Story:** A brand-new lead has a wrong phone number. The system should route the fix to the participant automatically, then route the callback back to the consultant.

**Do this:**
1. Sign in at `/auth/sign-in` as `berater@demo.de` / `demo1234`.
2. Click **Pipeline**. Find a card in the **Neuer Lead** column (or use **+ Neuer Lead** to create one).
3. Open the lead → in the call-script quick actions, click **`Falsche Nummer`**.
4. Go to **Aufgaben**. Look under the **Teilnehmer:in** group.
5. Click **`Link erzeugen`** on that task → copies a single-use magic link.
6. Paste the link in a **private/incognito window** → update the phone number → submit.
7. Return to **Aufgaben** (console).

**Expected / Pass:**
- ✅ After step 3, lead status → `wrong_number`; a **participant** task "Kontaktdaten korrigieren" appears with no manual routing.
- ✅ After step 6, a **consultant** task "Lead erneut anrufen" appears under the Intern group.
- ✅ The magic link is dead on second open ("bereits erledigt" / invalid).

*Covers README §1, §11, §12 (routing row "Phone number incorrect").*

---

## BM-2 🟢 — The 20h/6-month gate stops a doomed application early

**Story:** Funding fails later if 20h/week over 6 months isn't realistic. The gate must **block** qualification when the availability answer isn't a clear "Ja".

**Do this:**
1. Signed in as consultant, open **Pipeline** → pick a lead whose availability is **not** confirmed (anything not pre-answered "Ja, 20 Stunden…").
2. Open the lead detail page. In **Status ändern**, choose **Qualifiziert** and click **Übernehmen**.
3. Separately, in the **Pflicht-Check** box, record a non-yes answer such as **Unklar** or **Wahrscheinlich — Arbeitgeber-Freigabe offen**.

**Expected / Pass:**
- ✅ The action is **blocked** with an explicit German error (availability not confirmed).
- ✅ Recording **Unklar**, **Teilweise**, or **Nicht möglich** creates an internal consultant clarification task.
- ✅ Recording **Wahrscheinlich — Arbeitgeber-Freigabe offen** creates an employer task to confirm the time model.
- Contrast: run BM-9 first for Lena (confirms "Ja") — she qualifies without the block.

*Covers README §3 (the single most important drop-off predictor).*

---

## BM-3 🟡 — No-show cascade creates follow-up tasks; timed reminders/escalation need clock time

**Story:** A participant books a follow-up and doesn't show. Reschedule + reminder + escalation should fire automatically.

**Do this:**
1. Consultant → **Termine**.
2. Use the seeded **Marta** scheduled appointment, or create a new scheduled appointment from a lead detail page.
3. Click **`No-Show`**.
4. Go to **Aufgaben**.
5. Optional: keep `pnpm jobs:dev` running in a second terminal to drain due reminders/escalations when their scheduled time arrives.

**Expected / Pass:**
- ✅ A **reschedule** task for the participant appears in Aufgaben.
- ✅ A **consultant follow-up/no-show call** task appears in Aufgaben.
- 🟡 Scheduled appointment reminders are created when an appointment is planned through the app, but the seeded appointment itself is inserted directly and does not prove reminder creation.
- 🟡 Escalation is time-based (`escalationAt`) and will not fire immediately in a click-through benchmark unless the clock/data is advanced.

*Covers README §4, §16 (reminder flow), §17 (no-show rate).*

---

## BM-4 🟢 — Employer self-service unblocks the funding bottleneck

**Story:** PflegePlus has no Betriebsnummer. A guided 4-step wizard should let the employer fix it without email ping-pong, and partial saves must not burn the link.

**Do this:**
1. Consultant → **Arbeitgeber**. Find **PflegePlus Sozialdienste eG** (badge: `Betriebsnummer fehlt`).
2. Click **`Setup-Link erzeugen`** → copy the link.
3. Open it in a **private window**. Walk the wizard:
   - Step 1 **Betriebsnummer** → enter `00482173`.
   - Step 2 **Arbeitgeberservice-Status**.
   - Step 3 **Ansprechperson**.
   - Step 4 **Zeitmodell (20h/Woche)** → **answer only "teilweise"** and submit.
4. Note the "Zwischenstand gespeichert" message. **Close and reopen the same link.**
5. Now complete Step 4 fully → submit.
6. Reopen the link once more.

**Expected / Pass:**
- ✅ After step 4 (partial), link stays **valid** — reopening resumes the wizard.
- ✅ After step 5 (complete), "Vielen Dank"; reopening shows "bereits erledigt".
- ✅ Back in **Arbeitgeber**, PflegePlus derives to its next bottleneck / `Bestätigt`.

*Covers README §6, §7, §11 (employer tasks), partial-save semantics.*

---

## BM-5 🔴 — The real-form autofill loop closes (THE one that matters)

**Story:** All ghost data (Iva Petrić + Helios Marine + Nordlicht + measure) is present. Generate the **Trägerbescheinigung** (`ba042369`, 15 fields) — the **real BA form**, not the sample.

**Do this (today):**
1. Consultant → **Dokumente** → open a fully-populated participant (e.g. **Lena Hoffmann**).
2. Click **`Kostenübersicht`** → PDF generated (`Vorbefüllt`) → open it.
3. Click **`Teilnehmer-Stammblatt (Autofill)`** → AcroForm autofill path.

**Expected today:**
- 🔴 Documents generate against **`teilnehmer-stammblatt.pdf`**, an internal **SAMPLE** template stamped "MUSTER / PLATZHALTER". The 7 real BA PDFs in `../Antragsdokumente/` are **not wired** (verified in `src/modules/documents/generate.ts`).

**Pass condition (acceptance for Epic B — the real benchmark):**
- Drop `traegerbescheinigung-…_ba042369.pdf` into `templates/pdf/` + a `mapping.json` (`field → data path`).
- Generating the Trägerbescheinigung fills **all 15 fields** from the ghost dataset; output SHA-256 matches an expected fixture.
- Missing data still yields a `data_missing` doc + clarification task (existing behaviour preserved).
- **Start here:** 15 fields, all data the app already has (measure + participant + provider). Smallest slice that proves the real-form pipeline end-to-end.

*Covers README §9 (PDF autofill against a real form). This is the product's reason to exist.*

---

## BM-6 🟢 — Multi-signer co-sign is legally coherent (Phase 7)

**Story:** `erklaerung-gewaehrung` needs **both** the participant (Iva) and the employer (Beate). The document must not read "Signiert" until **both** sign, and two simultaneous submissions must finalize exactly once.

**Do this:**
1. Consultant → **Dokumente** → open a generated document that requires two signers.
2. Click **`Signatur anfordern`** for **both** the participant and the employer.
3. Go to **Aufgaben** → mint each signer's magic link (**`Link erzeugen`**).
4. **Signer 1 (participant)** — open link in a private window → draw signature on canvas → **`Bestätigen`**.
5. Check the document status in the console.
6. **Signer 2 (employer)** — open the second link → draw → **`Bestätigen`**.
7. From the console, **download** the signed document.

**Expected / Pass:**
- ✅ After signer 1: status → **`Teilweise signiert`** (`partially_signed`); the downstream `document/signed` routing rule does **not** fire yet.
- ✅ After signer 2: `finalizeIfComplete()` builds a **signed artifact** — signature stamps in the PDF footer band + an appended **audit-certificate page** listing each signer (name, kind, timestamp, IP, SHA-256).
- ✅ Status → `signed`; `signedFilePath` + `signedSha256` stored; the `document/signed` rule fires **exactly once** (guarded by a `FOR UPDATE` lock — concurrency-safe).
- ✅ Downloaded file is `application/pdf` and its SHA matches `signedSha256`.

*Covers README §13. Verified by `e2e/phase7-signatures.spec.ts`. This is the model every scenario should read like.*
> ⚠️ eIDAS gap: all signatures today are **SES** (canvas). QES-required BA declarations still need a provider (Skribble/Yousign) behind the `SignatureProvider` interface. Flag which forms legally need QES before go-live.

---

## BM-7 🟢 — Submission readiness gate holds the line

**Story:** An incomplete employer must block submission; a complete one must walk the full pipeline.

**Do this (blocked path):**
1. Admin → **Dokumente** → open **Jonas Petersen** → **`Antrag anlegen`**.
2. Go to **Anträge** → open Jonas.

**Expected / Pass (blocked):**
- ✅ Banner: **"Vervollständigung blockiert: Betriebsnummer fehlt, Arbeitgeberservice-Status nicht bestätigt"** (Jonas → PflegePlus, which lacks a Betriebsnummer).
- ✅ The **`Als vollständig markieren`** button is **hidden** — the application cannot reach `complete`.

**Do this (happy path):**
3. Open **Lena Hoffmann** (→ Nordbau GmbH, complete) → **`Antrag anlegen`** → **Anträge**.
4. Walk: **`Als vollständig markieren`** → **`Antragspaket exportieren`** → **`An Arbeitgeber senden`**.
5. Go to **Aufgaben**, mint the employer **Einreichung bestätigen** link, open it in a private window, tick the confirmation checkbox, and submit.
6. Return to **Anträge** and click **`Bewilligt`**.

**Expected / Pass (happy):**
- ✅ Full transition `in_preparation → complete → sent_to_employer → submitted → approved` succeeds; each step gated correctly.

*Covers README §14 (submission), §10 (checklist).*

---

## BM-8 🟢 — Analytics surfaces the real weakness

**Story:** The admin needs quality KPIs + a drop-off funnel, with filters that are real (not cosmetic).

**Do this:**
1. Admin → **Berichte**.
2. Read the KPI cards: Leads · Kontaktrate · Falsche-Nummer-Quote · No-Show · Eignungstest (Abschluss/Bestehen) · Arbeitgeber (Bestätigung/Betriebsnummer/AG-S) · Anträge (Einreichungs-/Bewilligungsquote) · Ø Lead→Antrag.
3. Set **Von/Bis** date range + **Beratung** filter → pick **`Anna Adler (Admin)`**.

**Expected / Pass:**
- ✅ All README §17 KPIs render, computed **live via SQL** (no rollup table).
- ✅ Per-status **funnel** matches the seed counts.
- ✅ Filtering by an owner with no leads (Anna Adler) drops counts to **0** — proves the filter actually queries, not just decorates.

*Covers README §17 (the entire quality-management promise).*

---

## BM-9 🟢 — Participant confirms availability in 2 minutes (external, no login)

**Story:** The 20h/6-month confirmation must be a one-screen, one-task external flow that flips the internal gate.

**Do this:**
1. Get Lena's availability link: from the seed output, or **Aufgaben → Lena's availability task → `Link erzeugen`**.
2. Open it in a **private window** → "Ja, 20 Stunden…" is pre-selected → click **`Antwort senden`**.
3. Back in the console, open Lena in **Pipeline**.

**Expected / Pass:**
- ✅ External page shows exactly **one** task; "Vielen Dank" on submit.
- ✅ Internally, Lena's availability flips to `yes` — she can now be qualified/enrolled (unblocks BM-2's contrast case).

*Covers README §11 (employee tasks), §3.*

---

## Scoreboard

| Scenario | What it proves | Status |
|---|---|---|
| BM-1 | Auto-routing on wrong number | 🟢 |
| BM-2 | 20h availability gate blocks | 🟢 |
| BM-3 | No-show → follow-up tasks; timed worker paths partial in manual run | 🟡 |
| BM-4 | Employer wizard + partial save | 🟢 |
| **BM-5** | **Real BA form autofill** | **🔴 open — Epic B** |
| BM-6 | Multi-signer co-sign + audit | 🟢 (Phase 7) |
| BM-7 | Submission readiness gate | 🟢 |
| BM-8 | Live analytics + real filters | 🟢 |
| BM-9 | External availability flow | 🟢 |

**Headline:** 7/9 journeys pass end-to-end, BM-3 is partially manual/time-dependent, and **BM-5 (real BA forms) is the single open product frontier**. Smallest valuable slice: wire the 15-field **Trägerbescheinigung** first.

---

## Data-coverage benchmark (why BM-5 is the frontier)

The 7 real BA forms need **535 AcroForm fields**; the app captures **~20%** today (`participants`: ~7 real fields, `employers`: ~7). The planned ghost dataset in `ghost-company.md` should be engineered to fill ~85% of those 535 fields — it will become the **expected-output fixture** for BM-5 once a form is wired.

| Data domain | Required by BA | Stored today | Coverage |
|---|---|---|---|
| Employer | ~31 | ~7 | ~22% |
| Participant | ~42 | ~7 | ~17% |
| Measure | ~6 | ~5 | ~80% |

Gap = **Epic A** (add the nullable columns) → unblocks **Epic B** (wire the forms, BM-5) → **Epic C** (sign the real forms, extends BM-6).
