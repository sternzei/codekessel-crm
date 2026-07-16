# QCG Application & Onboarding Web Application  
## Concept for AZAV-Certified Measures under the Qualification Opportunities Act

> **Developer quickstart** — architecture in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md);
> OpenRegister lead import (discovery, dedup, provenance, `import_runs`) in
> [docs/REGISTER-IMPORT.md](docs/REGISTER-IMPORT.md)
>
> ```bash
> pnpm install
> cp .env.example .env.local        # dev defaults work out of the box
> docker compose up -d              # Postgres 16 on localhost:5433
> pnpm db:migrate && pnpm db:seed   # schema + RLS + demo data
> pnpm dev                          # http://localhost:3000
> pnpm jobs:dev                     # reminder/escalation worker (separate terminal)
> pnpm test:unit                    # unit suite (utilities, transforms, gates)
> ```
>
> Sign in (internal console): `admin@demo.de` / `demo1234` or
> `berater@demo.de` / `demo1234`. The seed prints **four magic links**
> (availability check, contact correction, employer setup assistant, aptitude
> test) — open them in a private window to see the no-login external flows.
> Lost links are re-minted via "Link erzeugen" on the task board. E2E:
> `npx playwright test` (server must be running, re-seeds automatically).
>
> Env vars (see `.env.example`): `DATABASE_URL` (RLS-enforced app role),
> `MIGRATION_DATABASE_URL` (owner, migrations/seed only), `AUTH_SECRET`,
> `TOKEN_SECRET` (must differ), `APP_BASE_URL`. Optional live integrations:
> `APTITUDE_TEST_BASE_URL`, `WHATSAPP_ACCESS_TOKEN`,
> `WHATSAPP_PHONE_NUMBER_ID`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`.
> Without these, the app stays in demo-safe mode: task routing and audit logs
> run normally, while WhatsApp/email dispatch is mocked.

## Current Implementation Status

The application currently supports an end-to-end QCG onboarding demo:

- Internal lead pipeline, lead creation, call script, contact notes, eligibility
  fields, and mandatory 20h/week over 6 months availability gate.
- Undo (Ctrl/Cmd+Z) on the lead detail view: reverts the previous participant
  status and cancels the follow-up tasks and scheduled reminders that the
  undone transition spawned — without re-running the routing engine.
- Automatic task routing from status changes, including internal tasks,
  external magic-link tasks, reminders, and escalations.
- Participant magic-link flows for contact correction, availability,
  consent, appointment rescheduling, document upload, aptitude-test start,
  and document signature.
- Employer magic-link flows for Betriebsnummer, Employer Service status,
  contact person, time model, and submission confirmation.
- Configurable outbound messaging: Meta WhatsApp Cloud API and Resend email
  are used when credentials are configured; otherwise the adapter logs mock
  sends for local/demo runs.
- Configurable aptitude-test launch URL via `APTITUDE_TEST_BASE_URL`; the app
  appends `participant_id` to connect the external test provider back to the
  participant record.
- Document generation/checklist, application package export, canvas-based SES
  signatures, signed PDF artifacts, application status tracking, and reports.
- Multi-signer co-signing: parallel signers with a `partially_signed` state,
  finalization under a row lock, and a stamped artifact with an appended audit
  certificate.
- Analytics dashboard covering the §17 KPIs (contact, no-show, aptitude,
  employer-approval, and submission rates) plus the lead→application funnel
  with filters, computed from live SQL.

Still not production-final:

- Real WhatsApp templates, email sender/domain setup, and provider credentials
  must be supplied by the customer.
- The aptitude-test provider can be launched, but automatic result import is
  not implemented yet.
- BA/Arbeitsagentur upload forms: the Trägerbescheinigung and the
  Sammelantrag-Teilnehmerliste are wired against AcroForm autofill; the
  remaining upload forms still need field mappings. The large AEZ-Antrag is
  obsolete — applications are filed online via the BA eService (see
  `docs/ESERVICE-ANTRAG.md`).
- Consent/privacy wording, retention rules, and signature acceptance need legal
  review.
- Canvas signatures are simple electronic signatures only; QES providers such
  as Skribble/Yousign remain a later integration.

## 1. Objective

The planned web application supports the complete process from the first contact with a potential participant to the preparation and submission of application documents for an AZAV-certified training measure under the German Qualification Opportunities Act (QCG).

The goal is to reduce process drop-offs, avoid no-shows, clarify funding eligibility early, automate document preparation, and ensure that the right person always receives the right task at the right time.

The application acts as a role-based process assistant for:

- Employees / participants
- Employers
- Sales consultants / advisors
- Internal administration
- Optional: employer service contacts or external stakeholders

---

# 2. Core Process

## Step 1: First Contact / Initial Call

### Typical Problems

- Participant cannot be reached
- Phone number is incorrect
- No interest
- Funding eligibility unclear
- Employer situation unclear

### Solution in the Web Application

The lead is created and managed with a clear status:

- New lead
- Called
- Not reachable
- Wrong phone number
- Interested
- Not interested
- Eligibility unclear
- Employer needs to be involved

If the participant cannot be reached, the system automatically creates follow-up tasks:

- Send WhatsApp message
- Send email
- Schedule a callback
- Set a reminder for the sales consultant

If the phone number is incorrect, the system prepares an email asking the participant to provide correct contact details.

### Key Questions During the Initial Call

The first call should already clarify the most important qualification criteria:

- Is the person currently employed?
- Is there an employer involved?
- Is the employer generally open to further training?
- Is there a concrete qualification need?
- Is participation for approximately 20 hours per week over 6 months realistic?
- Is the employer able to support or release the employee for this time?
- Is the employer already registered with the Employer Service?
- Does the employer have a company registration number?

---

# 3. Availability Check

A critical qualification point is the availability of the participant and the employer.

## Required Check

The system should include a mandatory checkpoint:

> Is participation for approximately 20 hours per week over a period of 6 months possible?

### Possible Answers

- Yes, 20 hours per week for 6 months is possible
- Probably possible, but employer approval is still required
- Only partially possible
- Not possible at the moment
- Unclear

If the answer is not clearly positive, the system should automatically create a task:

> Clarify availability and employer approval.

### Why This Matters

If 20 hours per week over 6 months is not realistic, the process will most likely fail later during the application phase. Therefore, this point must be clarified as early as possible, ideally during the first call.

---

# 4. Follow-Up Appointment

## Typical Problems

- No-show
- No longer interested
- Not eligible for funding
- Employer not yet involved

## Solution in the Web Application

The follow-up appointment is scheduled directly in the system.

The system creates automatic reminders:

- WhatsApp reminder 24 hours before the appointment
- WhatsApp reminder shortly before the appointment
- Reminder call task for the sales consultant
- Option to reschedule with one click

The system should also ensure that basic eligibility has already been checked before a follow-up appointment is scheduled.

### Status Options

- Follow-up scheduled
- Reminder sent
- No-show
- Follow-up completed
- Not eligible
- Employer approval required
- Ready for aptitude test

---

# 5. Aptitude Test

## Typical Problems

- No-show
- Test not started
- Test not completed
- Participant does not understand the purpose of the test

## Solution in the Web Application

The system manages the full aptitude test process:

- Send test link
- Track test status
- Send reminders
- Create reminder call tasks
- Store results in the participant profile

### Test Status

- Invited
- Started
- Completed
- Passed
- Failed
- No-show

### Suggested Explanation to the Participant

> The aptitude test is not meant to exclude you unfairly. It helps us assess whether the training measure is realistic and suitable for your current situation.

### Automated Next Steps

If the participant passes the test:

- Continue to application document preparation

If the participant fails the test:

- Create task for consultation or alternative recommendation

If the participant does not show up:

- Send reminder
- Offer new appointment
- Set inactive after repeated no-shows

---

# 6. Employer Setup

The employer is often the main bottleneck in the QCG process. Therefore, the web application must include a dedicated employer workflow.

## Required Employer Data

- Company name
- Address
- Contact person
- Email address
- Phone number
- Company registration number
- Number of employees
- Industry
- Responsible employment agency
- Employer Service contact
- Confirmation of training support
- Confirmation of time model
- Confirmation of 20 hours per week over 6 months

---

# 7. Employer Service Assistant

The application should include a guided assistant for the employer.

## Purpose

The employer should not receive long explanations via email. Instead, the system should guide them step by step through the required information and actions.

## Employer Setup Assistant

### Step 1: Company Registration Number

Question:

> Do you have a company registration number?

Options:

- Yes → Enter number
- No → Show instructions
- Not sure → Ask payroll, tax advisor, HR, or management

### Step 2: Employer Service Registration

Question:

> Are you already registered with the Employer Service?

Options:

- Yes → Enter contact details
- No → Show registration instructions
- Not sure → Show explanation and next steps

### Step 3: Employer Contact Person

Question:

> Who is responsible for the training application in your company?

Required fields:

- Name
- Role
- Email
- Phone

### Step 4: Time Model Confirmation

Question:

> Can the employee participate in the training for approximately 20 hours per week over a period of 6 months?

Options:

- Yes
- Partially
- No
- Needs internal clarification

---

# 8. Employer Service Instructions

The application should include easy-to-understand instructions for employers.

## Instruction 1: Company Registration Number

Content:

- What is a company registration number?
- Where can the employer find it?
- Who usually knows it?
  - Payroll department
  - Tax advisor
  - HR department
  - Management
- What to do if the company does not have one
- Which information is required to obtain one

## Instruction 2: Employer Service Registration

Content:

- Why the Employer Service is relevant
- How to contact the Employer Service
- Which information is required
- Which role the employer plays in the funding process
- Which documents should be prepared

## Instruction 3: Application Process

Content:

- Select participant and training measure
- Check funding eligibility
- Provide employer data
- Prepare documents
- Submit application
- Wait for response from the employment agency

## Instruction 4: Common Mistakes

Typical mistakes:

- Company registration number missing
- Wrong contact person
- Employer Service not contacted
- Documents incomplete
- Application submitted too late
- Training start date too close to application date
- Employee not internally approved yet

---

# 9. PDF Autofill and Document Generation

## Objective

The application should collect all relevant data once and use it to automatically prepare the required application documents.

## Central Data Collection

### Participant Data

- Name
- Address
- Date of birth
- Phone number
- Email
- Employment status
- Desired training measure
- Training start date
- Training duration

### Employer Data

- Company name
- Address
- Contact person
- Email
- Phone number
- Company registration number
- Number of employees
- Industry
- Responsible employment agency
- Employer Service contact

### Training Measure Data

- Name of measure
- AZAV measure number
- Duration
- Format
- Costs
- Start date
- Target group
- Training objective

---

## PDF Autofill

The system should support automatic preparation of documents.

### Possible Documents

- Participant form
- Employer data sheet
- Training measure information sheet
- Cost overview
- Internal checklist
- Cover letter to employer
- Cover letter to Employer Service
- Application package

### Document Status

- Data missing
- Automatically prefilled
- Manually reviewed
- Approved
- Sent
- Submitted
- Signed

## Two Technical Options

### Option A: Real PDF Autofill

If the PDF contains fillable form fields, the system fills these fields automatically.

### Option B: Document Generation

If the PDF does not contain usable form fields, the system generates a new PDF from a template, for example from HTML or DOCX.

This option is often more stable and easier to control.

---

# 10. Document Checklist

Before submission, the application should clearly show what is still missing.

## Example Checklist

| Item | Status |
|---|---|
| Participant data complete | Green |
| Employer data complete | Green |
| Company registration number available | Yellow / Red |
| Employer Service status confirmed | Yellow / Red |
| Training measure data complete | Green |
| Cost overview created | Green |
| Application package reviewed | Yellow |
| Required signatures completed | Red |
| Submission confirmed | Red |

---

# 11. Role-Based Task Links

A key feature of the application is that the right person receives the right task through a direct link.

The person should not need to log into a complex system or search for the right page. The link opens exactly the task that needs to be completed.

## Roles

- Employee / participant
- Employer
- Sales consultant / advisor
- Internal administrator
- Optional: external contact

---

## Tasks for the Employee

The employee receives links for:

- Review contact details
- Confirm availability
- Confirm 20 hours per week over 6 months
- Accept privacy policy
- Give consent for contact
- Start aptitude test
- Upload documents
- Confirm participation interest
- Sign documents digitally

### Example Message

> Hello, please complete your information for the funded training program. This will take approximately 5 minutes.

---

## Tasks for the Employer

The employer receives links for:

- Review company data
- Enter contact person
- Enter company registration number
- Confirm number of employees
- Confirm Employer Service status
- Confirm time model
- Confirm 20 hours per week over 6 months
- Review application documents
- Sign documents digitally
- Confirm submission

### Employer Portal Principle

The employer should see only a very simple task view:

1. Read task
2. Complete missing data
3. Review document
4. Sign
5. Submit

---

## Tasks for the Sales Consultant

The sales consultant receives tasks such as:

- Call lead
- Send WhatsApp message
- Send email
- Schedule follow-up
- Perform reminder call
- Check funding eligibility
- Contact employer
- Follow up on aptitude test
- Review document status
- Handle no-show
- Track application submission

The consultant works mainly with a pipeline and task dashboard.

---

# 12. Automatic Task Routing

The application should automatically decide who needs to do what next.

## Examples

| Situation | Task Goes To |
|---|---|
| Phone number incorrect | Employee via email |
| Participant not reachable | Sales consultant + employee via WhatsApp/email |
| Follow-up scheduled | Employee + sales consultant |
| Aptitude test open | Employee |
| Company registration number missing | Employer |
| Employer Service status unclear | Employer |
| 20h/week not confirmed | Employer + employee |
| Document data missing | Responsible person |
| Signature missing | Person required to sign |
| Application package ready | Internal administration |
| Submission still open | Employer or internal administration |

---

# 13. Digital Signatures

The system should include a signature module.

## Signature Process

1. Data is collected in the system
2. PDF is generated or prefilled
3. System identifies who needs to sign
4. Signature link is sent
5. Person opens the link
6. Person reviews the document
7. Person signs digitally
8. Signed PDF is stored automatically
9. Status changes to “signed”
10. Next task is triggered automatically

---

## Signature Types

### Type A: Simple Digital Confirmation

Useful for less critical confirmations.

Includes:

- Checkbox
- Name
- Date
- Timestamp
- IP address
- Confirmation text

Example:

> I confirm that the information provided is correct.

Useful for:

- Availability confirmation
- Privacy confirmation
- Upload approval
- Internal process confirmations

### Type B: Browser-Based Handwritten Signature

The person signs directly on a smartphone, tablet, or laptop.

Useful for:

- Participant confirmation
- Employer confirmation
- Simple declarations of consent

### Type C: External Signature Provider

For legally more sensitive documents, the system can later integrate with providers such as:

- DocuSign
- Adobe Sign
- Skribble
- FP Sign
- Yousign

For the MVP, a practical approach would be:

> PDF generation + browser-based signature + audit log.

---

# 14. Application Submission

## Typical Problems

- No-show
- No time
- Documents incomplete
- Employer delays submission
- Unclear submission responsibility
- No response from Employer Service

## Solution in the Web Application

The system provides a final submission workflow:

- Final checklist
- Generate application package
- Export PDF package
- Prepare email to employer or Employer Service
- Document submission date
- Track response status
- Create follow-up reminders

### Submission Status

- Application in preparation
- Application complete
- Sent to employer
- Submitted
- Response pending
- Approved
- Rejected
- Correction required

---

# 15. Portals

## Internal Portal

For sales, advisors, and administration.

Main features:

- Lead pipeline
- Task dashboard
- Appointment management
- Document status
- No-show tracking
- Application pipeline
- Communication history
- Signature status
- Reporting

## Employee Portal

A very simple view for the participant.

Main features:

- My next steps
- Complete personal data
- Confirm availability
- Start aptitude test
- Upload documents
- Confirm appointments
- Sign documents

## Employer Portal

A very simple view for the employer.

Main features:

- Complete company data
- Enter company registration number
- Open Employer Service instructions
- Confirm time model
- Confirm 20 hours per week over 6 months
- Review documents
- Sign documents
- Confirm submission

---

# 16. Reminder and Escalation Logic

The system should reduce manual follow-up work by using reminders and escalation rules.

## Channels

- Email
- WhatsApp
- SMS optional
- Internal task
- Phone call reminder

## Example Reminder Flow

### Follow-Up Appointment

- 24 hours before: WhatsApp reminder
- 2 hours before: WhatsApp reminder
- 30–60 minutes before: sales consultant receives call reminder

### Aptitude Test

- Test link sent immediately
- Reminder after 24 hours
- Reminder after 48 hours
- Sales consultant task after no completion

### Employer Data Missing

- Employer receives task link
- Reminder after 2 days
- Sales consultant receives escalation after 5 days

### Signature Missing

- Signature link sent
- Reminder after 24 hours
- Reminder after 72 hours
- Escalation to internal administration

---

# 17. Analytics and Quality Management

The application should make process weaknesses measurable.

## Key Metrics

- Number of new leads
- Contact rate
- Wrong phone number rate
- No-show rate
- Follow-up completion rate
- Aptitude test completion rate
- Aptitude test pass rate
- Employer approval rate
- Missing company registration number rate
- Missing Employer Service registration rate
- Average time from lead to application
- Application submission rate
- Approval rate
- Drop-off reasons per process step

## Purpose

These metrics help continuously improve:

- Lead quality
- Call scripts
- Reminder timing
- Employer communication
- Document preparation
- Application success rate

---

# 18. MVP Scope

## MVP Features

The first productive version should include:

1. Lead management
2. Pipeline view
3. Call script
4. Contact notes
5. Funding eligibility check
6. Availability check: 20 hours per week over 6 months
7. Follow-up appointment management
8. WhatsApp and email templates
9. Reminder tasks
10. Aptitude test status tracking
11. Employee profile
12. Employer profile
13. Employer Service assistant
14. Company registration number instructions
15. Employer Service instructions
16. Central data collection
17. Document checklist
18. PDF autofill or document generation
19. Role-based task links
20. Employee portal
21. Employer portal
22. Digital signatures
23. Application package export
24. Submission tracking
25. Reminder and escalation logic
26. No-show and drop-off reporting

---

# 19. Suggested System Logic

## Process Flow

1. Lead is created
2. Sales consultant calls lead
3. System checks interest, eligibility, employer, and availability
4. If suitable, follow-up appointment is scheduled
5. Reminder messages are sent automatically
6. Participant completes aptitude test
7. Employer receives setup link
8. Employer completes company data
9. Employer confirms time model and 20h/week availability
10. System prepares documents
11. Required persons receive signature links
12. Signed documents are stored automatically
13. Application package is created
14. Application is submitted
15. Response is tracked
16. Final status is documented

---

# 20. Professional Concept Text

The web application supports the complete onboarding and application process for AZAV-certified training measures under the Qualification Opportunities Act. It guides participants, employers, sales consultants, and internal administration through a structured and role-based workflow from initial contact to application submission.

A key objective of the system is to reduce typical process drop-offs. Issues such as unreachable leads, wrong phone numbers, no-shows, missing employer approval, missing company registration numbers, missing Employer Service registration, incomplete documents, and missing signatures are addressed through automated reminders, guided task links, checklists, document generation, and digital signatures.

The application ensures that each stakeholder receives only the tasks relevant to their role. Employees can confirm availability, complete personal information, start aptitude tests, upload documents, and sign forms. Employers can complete company data, confirm the time model, provide the company registration number, follow Employer Service instructions, review documents, and sign required confirmations. Sales consultants and internal teams manage the process through a transparent pipeline, task dashboard, and application status tracking.

By combining central data collection, PDF autofill, document generation, role-based portals, secure task links, and digital signatures, the system creates a standardized, traceable, and quality-assured process. At the same time, process data such as no-show rates, drop-off reasons, missing documents, processing times, and successful application submissions can be analyzed to continuously improve the overall workflow.
