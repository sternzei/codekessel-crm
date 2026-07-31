# Deploying to Vercel + Supabase

The shape of this deployment:

| Piece | Where | Why there |
|---|---|---|
| Web tier (Next.js) | Vercel, region `fra1` | Push-to-deploy, no servers to patch |
| Database | Supabase Postgres, Frankfurt | Plain Postgres, so the RLS model moves unchanged |
| Documents & uploads | Supabase Storage (S3-compatible) | Browsers can upload to it directly |
| Reminder/escalation worker | One always-on machine (Fly, Railway, a VM) | Vercel has no long-running processes |

Everything below is in EU regions on purpose. Participants hand this app their
SV-Nummer, their IBAN and a signature; that data has no business crossing the
Atlantic because a default region said so.

**The worker is not optional.** Reminders, escalations and rate-limit cleanup
all live in it. Without it the app looks fine and quietly stops chasing anyone.

---

## 1. Supabase project

Create a project in the **Frankfurt (eu-central-1)** region and keep three
things from the dashboard:

- **Direct connection** (`Project settings → Database`), used for migrations
  and by the worker. Runs as `postgres`, the schema owner.
- **Transaction pooler** connection (port `6543`), used by the web tier. Every
  serverless instance holds its own pool, so they must be multiplexed.
- **Project ref**, the subdomain in `https://<ref>.supabase.co`.

### Create the application role

The app never connects as the owner. It connects as `qcg_app`, a role that
owns nothing and sees nothing until a transaction declares which tenant it is
acting for — that is what RLS enforces. Migration `0001` creates the role with
a development password; replace it before anything real is in the database.

Run in the Supabase SQL editor:

```sql
-- The role itself is created by migration 0001; this only sets a real secret.
-- If you run migrations first, the role already exists and this is enough:
ALTER ROLE qcg_app WITH LOGIN PASSWORD 'a-long-random-password';
```

Generate that password with `openssl rand -base64 32` and put it nowhere but
the environment variables below.

### Run the migrations

From your machine, with the **direct** connection string:

```bash
MIGRATION_DATABASE_URL='postgres://postgres:<pw>@db.<ref>.supabase.co:5432/postgres' \
  pnpm db:migrate
```

Migration `0021` is the one that matters for this platform: Supabase publishes
the `public` schema through an auto-generated REST API and grants the `anon`
role access to new tables by default. `anon` is reachable with a key that is
public by design, so that migration revokes those grants and enables RLS on the
two tables that had none. Do not skip it, and do not re-grant `anon` later.

### Create the first tenant and admin

```bash
MIGRATION_DATABASE_URL='...' pnpm bootstrap:tenant
```

This is additive and safe against a database with data in it. `pnpm db:seed` is
the opposite — it wipes every table — so never point it at production.

---

## 2. Supabase Storage

Create a **private** bucket (`documents`, say). Private is not a detail: these
objects are medical-adjacent employment records, and a public bucket makes
every one of them a URL away from anyone.

Then create S3 access keys under `Project settings → Storage → S3 access keys`.
The app talks to Storage through its S3-compatible endpoint, which is why no
Supabase SDK appears anywhere in this codebase.

Uploads go **straight from the participant's browser to the bucket**. The app
signs a URL for one object, with the content type and the exact byte count
baked into the signature, and only learns about the file afterwards — at which
point it reads the bytes back and checks that they really are a PDF or an image
before filing anything. A serverless request body is capped at 4.5 MB; a
scanned document is regularly larger.

For that to work the bucket must accept cross-origin `PUT` from your app's
domain. Supabase allows this by default; if you have tightened CORS, add the
production domain back.

---

## 3. Vercel

Import the repository. The framework and region come from `vercel.json`
(`fra1`), and `next.config.ts` already traces the PDF fonts and BA form
templates into the function bundle — without that every generated document is
a 500, because those files are read from disk at request time.

### Environment variables

Set these for the **Production** environment only. Preview deployments each get
a fresh URL, which breaks both magic links and the OAuth redirect, and pointing
them at the production database would let a branch write to real data.

| Variable | Value |
|---|---|
| `DATABASE_URL` | Transaction pooler URL, user `qcg_app.<ref>`, port `6543` |
| `DB_POOL_MAX` | `1` |
| `MIGRATION_DATABASE_URL` | Leave unset on Vercel — the web tier must not own the schema |
| `APP_BASE_URL` | `https://your-domain` (the stable one, not a deployment URL) |
| `AUTH_SECRET` | `openssl rand -base64 48` |
| `TOKEN_SECRET` | A **different** `openssl rand -base64 48` |
| `TRUST_PROXY` | `true` |
| `STORAGE_DRIVER` | `s3` |
| `S3_BUCKET` | Your bucket name |
| `S3_REGION` | `eu-central-1` |
| `S3_ENDPOINT` | `https://<ref>.supabase.co/storage/v1/s3` |
| `S3_FORCE_PATH_STYLE` | `true` |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | From the Storage S3 keys |
| `LEGAL_PROVIDER_NAME` / `_ADDRESS` / `_EMAIL` | Operator identity for the Impressum |
| `RESEND_API_KEY` / `RESEND_FROM_EMAIL` | Optional; without both, email stays mocked |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Optional; without both, the Google button disappears |

`env.ts` validates all of this at build time, so a missing value fails the
deployment instead of surfacing as a 500 next Tuesday.

Two of them are worth dwelling on. `DB_POOL_MAX=1` exists because serverless
inverts the usual pooling assumption: there is no single pool, there are as
many as there are live instances, and ten connections each will exhaust
Supabase's limit long before real load does. `TRUST_PROXY=true` is what makes
rate limiting key on the caller's actual address rather than one shared bucket
— it is only safe because Vercel sets `x-forwarded-for` itself.

### Deploying without connecting the repository

Importing from GitHub needs the Vercel app installed on the account that owns
the repository, which is not always yours to grant. The CLI has no such
requirement: it uploads the working directory and builds it on Vercel.

```bash
pnpm dlx vercel login
pnpm dlx vercel link          # creates or attaches the project
pnpm dlx vercel env pull      # optional: check what is already set
pnpm dlx vercel deploy --prod
```

The environment variables still have to exist **before** the first build,
because `env.ts` runs during it. Fastest route: fill this in as a local
`.env.production.local` (already gitignored) and paste it into the Vercel
dashboard, which accepts a whole `.env` at once — the CLI's `env add` takes one
variable per invocation.

```dotenv
DATABASE_URL=postgres://qcg_app.<ref>:<qcg_app-pw>@aws-0-eu-central-1.pooler.supabase.com:6543/postgres
DB_POOL_MAX=1
APP_BASE_URL=https://<your-domain>
AUTH_SECRET=<openssl rand -base64 48>
TOKEN_SECRET=<a different openssl rand -base64 48>
TRUST_PROXY=true
STORAGE_DRIVER=s3
S3_BUCKET=documents
S3_REGION=eu-central-1
S3_ENDPOINT=https://<ref>.supabase.co/storage/v1/s3
S3_FORCE_PATH_STYLE=true
S3_ACCESS_KEY_ID=<from Storage S3 keys>
S3_SECRET_ACCESS_KEY=<from Storage S3 keys>
LEGAL_PROVIDER_NAME=<operator legal name>
LEGAL_PROVIDER_ADDRESS=<street\npostcode city>
LEGAL_PROVIDER_EMAIL=<contact address>
```

Deliberately absent: `MIGRATION_DATABASE_URL`. The web tier must not hold a
connection that owns the schema and bypasses RLS.

The trade-off is that nothing deploys itself afterwards: every release is
another `vercel deploy --prod` from a checkout that is up to date. Worth
switching to the git integration once someone can install the app on the
repository.

### After the first deploy

If you use Google sign-in, add `https://your-domain/auth/google/callback` to
the authorized redirect URIs in the Google Cloud console. It must match
exactly, including the scheme.

---

## 4. The worker

Same image, different command: `node dist/worker.mjs --loop`. `fly.worker.toml`
is ready to use.

```bash
fly launch --no-deploy --copy-config --config fly.worker.toml
fly secrets set --config fly.worker.toml \
  MIGRATION_DATABASE_URL='postgres://postgres:<pw>@db.<ref>.supabase.co:5432/postgres' \
  DATABASE_URL='<same, or the pooler>' \
  APP_BASE_URL='https://your-domain' \
  AUTH_SECRET='...' TOKEN_SECRET='...' TRUST_PROXY=true \
  STORAGE_DRIVER=s3 S3_BUCKET=... S3_REGION=eu-central-1 \
  S3_ENDPOINT='https://<ref>.supabase.co/storage/v1/s3' S3_FORCE_PATH_STYLE=true \
  S3_ACCESS_KEY_ID=... S3_SECRET_ACCESS_KEY=... \
  LEGAL_PROVIDER_NAME='...' LEGAL_PROVIDER_ADDRESS='...' LEGAL_PROVIDER_EMAIL='...'
fly deploy --config fly.worker.toml
```

The secrets are near-identical to the web tier because the worker sends the
same messages, mints the same magic links and reads the same documents. Two
differences: it connects as the **owner** (`MIGRATION_DATABASE_URL`), since it
works across tenants by design and is never reachable from a request; and it
should use the direct connection rather than the transaction pooler, being one
long-lived process with a pool of three.

It logs a heartbeat roughly once a minute. If those stop, reminders have
stopped — that is the one thing worth alerting on.

---

## 5. Verify

In order, because each step depends on the one before:

1. `https://your-domain/api/ready` returns ok — that one actually reaches the
   database, unlike `/api/health`, which only proves the process is up.
2. Sign in with the bootstrap admin.
3. Create a lead, mint an upload link, and upload a real PDF from a phone. This
   exercises the presigned upload end to end; a file that lands in the bucket
   but never appears under the participant means the read-back check rejected
   it, and the server logs say why.
4. Open a generated document. If this 500s, the font and template tracing did
   not survive the build.
5. Schedule something that produces a reminder and confirm the worker picks it
   up within a minute.

---

## What this deployment does not solve

- **Backups.** Supabase's automatic backups cover the database. With
  `STORAGE_DRIVER=s3` the documents live outside it, so they need their own
  copy — a bucket with no backup is a single delete away from gone.
- **Abandoned uploads.** A participant who picks a file and closes the tab
  leaves an object in the bucket that no row references. Nothing collects
  those yet; at this volume it is noise, but it is not self-cleaning.
- **Preview deployments** cannot reach the production database by design, so
  they will not be usable for testing against real data. That is deliberate.
- **The secret key.** Supabase's `service_role` key bypasses RLS entirely.
  This app never uses it. Treat it as a root password: never in a browser,
  never in a preview environment, never in the repository.
