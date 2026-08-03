# System overview

Four views of the same system: where it runs, what it does to a lead, how work
gets chased without anyone watching, and who is allowed to see what. Together
they are meant to answer the questions a reviewer asks first — what breaks if
this box dies, and what stops tenant A from reading tenant B.

---

## 1. Deployment

What actually runs, as of the first production deploy.

```mermaid
flowchart TB
    subgraph browser["Browser"]
        staff["Internal staff<br/>consultant · manager · admin"]
        ext["Participant / employer<br/>no account, magic link only"]
    end

    subgraph vercel["Vercel · fra1 · Next.js App Router"]
        rsc["Server components<br/>+ server actions"]
        api["Route handlers<br/>/api/ready · /api/health<br/>/auth/google/*"]
    end

    subgraph supabase["Supabase · eu-north-1"]
        pooler["Supavisor<br/>transaction pooler :6543"]
        pg[("PostgreSQL<br/>23 tables · RLS on every one")]
        bucket[("Storage bucket 'documents'<br/>S3-compatible, private")]
    end

    worker["Worker · always-on host<br/>node dist/worker.mjs --loop<br/>NOT YET DEPLOYED"]
    resend["Resend<br/>NOT CONFIGURED — mailing is simulated"]

    staff -->|session cookie| rsc
    ext -->|signed one-time token| rsc
    rsc --> api
    rsc -->|"as role qcg_app, pool max 1"| pooler
    api --> pooler
    pooler --> pg

    rsc -->|"presigned PUT, 15 min"| bucket
    ext -.->|"uploads bypass the app entirely"| bucket

    worker -->|direct connection :5432| pg
    worker -.-> resend
    rsc -.-> resend

    classDef missing fill:#fee,stroke:#c00,stroke-dasharray: 4 3
    class worker,resend missing
```

**Why the pool is capped at one.** Serverless inverts the usual assumption:
there is no single pool, there is one per live instance. Ten connections each
exhausts Postgres long before real load does, so each function holds one and
Supavisor multiplexes them onto real backends.

**Why uploads skip the app.** A Vercel request body is capped at 4.5 MB and a
scanned ID is regularly larger. The server signs a URL for one object — with the
content type and exact byte count inside the signature — and the browser PUTs
straight to the bucket. The app only learns about the file afterwards, reads the
bytes back, and verifies they really are a PDF or an image before filing
anything.

**The two red boxes are real gaps.** Without the worker nothing is chased: no
reminder fires and no task escalates. Without Resend credentials every message
is written to the outbox and marked simulated instead of leaving the building.
Both are configuration, not code.

---

## 2. What happens to a lead

The participant status enum, as the pipeline actually moves.

```mermaid
stateDiagram-v2
    [*] --> new: import or manual entry

    new --> called
    called --> not_reachable
    called --> wrong_number
    not_reachable --> called: retry
    called --> interested
    called --> not_interested

    interested --> eligibility_unclear: 20h/week × 6 months in doubt
    eligibility_unclear --> employer_pending: employer must confirm hours
    employer_pending --> qualified: confirmed
    eligibility_unclear --> qualified: clarified directly
    interested --> qualified: eligibility obvious

    qualified --> test_phase: aptitude test sent
    test_phase --> documents_phase: passed
    documents_phase --> application_phase: forms signed
    application_phase --> enrolled: employer + agency approved

    not_interested --> lost
    wrong_number --> lost
    test_phase --> lost: failed / no-show
    employer_pending --> lost: employer declines

    enrolled --> [*]
    lost --> [*]
```

The gate that shapes everything is availability: 20 hours a week for six months.
`employer_pending` exists because that answer usually is not the participant's
to give — it depends on their employer agreeing to a time model, which is why
employers are a first-class entity with their own status list rather than a text
field on the participant.

---

## 3. How work gets chased

The part that makes it a system rather than a spreadsheet: a state change
creates a task, a task that goes unanswered chases itself, and an external
person can act without ever holding an account.

```mermaid
sequenceDiagram
    autonumber
    participant C as Consultant
    participant App as Next.js
    participant DB as PostgreSQL
    participant W as Worker loop
    participant P as Participant

    C->>App: moves lead to a new status
    App->>DB: routing_rules lookup for that transition
    DB-->>App: who owns it, which channel, which template
    App->>DB: insert task + outbound_message + reminder_job
    App->>DB: append to activity_log

    Note over App,P: A message to an outsider carries a signed one-time link.
    App->>P: e-mail carrying /t/TOKEN

    P->>App: opens the link
    App->>DB: verify signature, expiry, single use
    App-->>P: exactly one task screen, nothing else
    P->>App: uploads documents / signs
    App->>DB: burn token first, then write rows

    loop every cycle
        W->>DB: reminder_jobs due?
        W->>P: send reminder, or create a call task
        W->>DB: tasks overdue?
        W->>DB: escalate to the responsible manager
        W->>DB: prune expired rate_limit_buckets
    end
```

**The token is the whole external surface.** No accounts for participants or
employers: a link scoped to one task, expiring, single use, and burnt before any
write happens so a double submit cannot produce two rows.

**Templates and routing rules are data.** A tenant without those 26 rules and 42
templates looks perfectly healthy and silently never chases anyone — which is
why bootstrapping them is a deployment step, not a seed script for demos.

---

## 4. Who can see what

```mermaid
flowchart LR
    subgraph roles["Session roles"]
        cons["consultant<br/>own pipeline"]
        mgr["manager<br/>+ escalations, users"]
        adm["admin<br/>+ approvals, all users"]
    end

    subgraph gates["Gates, in order"]
        g1["1 · Session cookie<br/>signed, must be approved + active"]
        g2["2 · Permission check<br/>in the server action"]
        g3["3 · withTenant transaction<br/>sets the tenant for the statement"]
        g4["4 · Row-level security<br/>enforced by Postgres"]
    end

    pending["pending<br/>self-registered via Google"]
    anon["anon / authenticated<br/>Supabase auto REST API"]

    cons --> g1
    mgr --> g1
    adm --> g1
    g1 --> g2 --> g3 --> g4
    g4 --> data[("Tenant rows")]

    pending -.->|blocked at gate 1<br/>waits in the approval queue| g1
    anon -.->|"0 table grants, 0 function EXECUTE"| data

    classDef blocked fill:#fee,stroke:#c00
    class pending,anon blocked
```

**Four gates, and the last one is not ours.** Application code decides what to
ask for; Postgres decides what may be returned. The app connects as `qcg_app`, a
role that owns nothing, so a missed `where tenant_id = …` returns no rows rather
than someone else's. That is the difference between a bug and a breach.

**Signing in with Google grants nothing by itself.** Anyone can create a row;
the row lands as `pending` and only an admin can move it to `approved`. Two
things bound the abuse: an address is only matched inside the tenant a
registration would join, so a Google account cannot be linked into a tenant it
was never invited to, and the pending queue is capped so it cannot be filled all
afternoon.

**The Supabase REST API is closed.** Supabase exposes `public` over PostgREST to
the `anon` role by default; a hardening migration revokes every table grant and
every function EXECUTE, so the database is reachable only through the app.
