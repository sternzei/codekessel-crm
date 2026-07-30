# Smoke path (ohne Meta WhatsApp)

Walk this checklist on a freshly seeded staging/demo tenant in under 30 minutes.
Demo logins: `admin@demo.de` / `leitung@demo.de` / `berater@demo.de` — password `demo1234`.

WhatsApp Cloud API is **parked**. Assert only **WhatsApp öffnen** (wa.me); never a fake Cloud “versendet”.

## 0. Bootstrap

- [ ] `docker compose up -d` (Postgres) + `pnpm db:migrate` + `pnpm db:seed`
- [ ] Or full stack: `docker compose --profile app up -d --build` then `curl -fsS localhost:3000/api/health`
- [ ] Sign in as `admin@demo.de`

## 1. Register-Import → Lead

- [ ] Open `/leads/import` (admin only)
- [ ] Search/import a company (OpenRegister key) **or** confirm seeded leads exist on `/pipeline`
- [ ] Open a lead on `/leads/[id]`

## 2. Claim lead

- [ ] As `berater@demo.de`, open an unassigned lead
- [ ] Claim / assign yourself (write actions require claim)
- [ ] Confirm ownership on the lead detail header

## 3. Availability

- [ ] Set availability internally on the lead **or** open the seeded magic link `/t/[token]`
- [ ] Answer “Ja, 20 Stunden…” externally
- [ ] Confirm status + internal follow-up task “Nächste Schritte planen…”

## 4. Employer setup

- [ ] As manager/admin: `/employers` → **Setup-Link erzeugen**
- [ ] Open `/t/[token]` as employer; complete Betriebsnummer → AG-S → contact → Zeitmodell
- [ ] Confirm employer status progresses (consultant cannot mint AG links)

## 5. Document + dual sign

- [ ] `/documents` → generate a document for the lead/employer pair
- [ ] Issue signature requests; both signers complete via `/t/[token]`
- [ ] Confirm stamped PDF only after **all** signers finish

## 6. Package export

- [ ] `/applications` → export / build package for the participant
- [ ] Confirm package artifact is listed

## 7. Submission

- [ ] Mark application submitted / confirm submission status on the application
- [ ] Spot-check activity on the lead **Verlauf**

## 8. WhatsApp interim (wa.me only)

- [ ] `/tasks` → open a WhatsApp-capable task
- [ ] Click **WhatsApp öffnen** → browser/app opens wa.me (or shows phone missing)
- [ ] With Cloud unset: assert **no** Postausgang “Cloud versendet” success for that click
- [ ] Optional: with `RESEND_*` set, trigger one email reminder path and confirm live send (or mock without keys)

## Done when

Second person can complete steps 1–8 without code changes; PDF storage survives compose restart (`qcg-uploads` or S3).
