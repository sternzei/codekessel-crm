# CRM-Redesign: Design System, Technical Plan & Phased Rollout

**Date:** 2026-07-28  
**Status:** Planning document with Phase 0 decision spikes and blockers  
**Scope:** Design system inventory, component architecture, technical strategy (Next.js 16 App Router), accessibility compliance (WCAG 2.2 AA), phased migration with rollback, detailed PR-sized backlog. Requires Phase 0 decisions before Phase 1 implementation begins.

---

## 1. Design System & Component Inventory

### 1.1 Current State: Existing Component Audit

The application currently uses a **token-driven CSS system** (no Tailwind, no component library) defined in:
- `src/styles/tokens.css` (semantic color, typography, spacing, motion tokens) — **55 lines**
- `src/styles/global.css` (BEM-like utility classes) — **1,148 lines**

#### Existing Components & Patterns (from `global.css`)

| Component | CSS Class(es) | Purpose | Accessibility Status |
|---|---|---|---|
| **App Shell** | `.shell`, `.sidebar`, `.main` | Layout container: sticky left sidebar (232px) + main area; 100dvh grid | Basic (no ARIA labels) |
| **Sidebar** | `.sidebar-*` (brand, footer, nav) | Navigation + branding; `.nav-link:focus-visible` outline present | Partial (no role="navigation") |
| **Topbar** | — | **Missing** — no dedicated top bar component (internal routes use sidebar-only layout) | N/A |
| **Tables** | `.pipeline-table*` (headers, rows, sort, links, filters) | Sortable lead pipeline table with bulk selection; row hover states | Partial (no ARIA table semantics) |
| **Filters** | `.pipeline-filters*` (search, status checkboxes, actions) | Multi-faceted filter with saved views UI pending | Partial (checkboxes manual, no aria-label) |
| **Status Badges** | `.badge`, `.badge--{ok,warn,danger}` | Inline status indicators using color only | Poor (color-only, no text alternative) |
| **Timeline/Activity** | `.timeline`, `.timeline .event` | Vertical activity log (flex column) | Minimal (no list semantics) |
| **Command Bar** | — | **Missing** — no global search/command palette | N/A |
| **Modals/Drawers** | — | **Missing** — no reusable modal/overlay components (task pages use full-page layouts) | N/A |
| **Forms** | `.field`, `.field {label, input, select, textarea}`, `.form-error` | Basic text/email/select fields; no validation UI | Partial (no aria-describedby, aria-invalid) |
| **Buttons** | `.button`, `.button--{ghost,danger,sm}` | Primary, ghost, danger variants; focus outline present | Partial (no aria-busy for async) |
| **Confirmations** | — | **Missing** — no reusable confirmation dialog | N/A |
| **Charts/KPI** | `.kpi-grid`, `.kpi-card`, `.funnel` | Dashboard KPI cards + funnel chart; no tooltip/interaction | Minimal (no aria-label on custom SVG if used) |
| **Toasts/Banners** | `.gate-banner`, `.info-banner` | Static inline alerts (not dismissible) | Poor (no role="alert") |
| **Skeleton/Empty/Error** | `.empty-state` | Placeholder div only; loading/error states not systemized | Missing |

#### Design Token Inventory (tokens.css)

```
Colors:
  - Surfaces: --color-{bg, surface, surface-raised, sidebar, line}
  - Ink: --color-{ink, ink-soft, ink-faint, sidebar-text, sidebar-muted}
  - Semantic: --color-{accent, accent-strong, accent-soft, ok, warn, danger} + soft variants
  
Typography:
  - Font: --font-{sans, mono}
  - Sizes: --text-{xs, sm, base, lg, xl, hero} (clamp-based, responsive)
  
Spacing:
  - Scale: --space-{1,2,3,4,6,8,12} (0.25rem — 3rem, 0.25 increment)
  
Radius & Shadows:
  - Radius: --radius-{sm, md, lg} (6px, 10px, 16px)
  - Shadows: --shadow-{card, raised}
  
Motion:
  - Duration: --duration-fast (150ms)
  - Easing: --ease-out (cubic-bezier(0.16, 1, 0.3, 1))
```

### 1.2 Target: New Design System Components

Build a **modular, composable component system** aligned to existing tokens, accessible by default, compatible with Next.js 16 server/client boundaries.

#### New Component Spec

| Component | Scope | Purpose | Accessibility | Implementation |
|---|---|---|---|---|
| **AppShell** | Layout | Grid container: optional topbar, sidebar, main, footer | `<div role="document">` | Server layout component |
| **Sidebar** | Nav | Navigation drawer, toggleable on mobile | `<nav>`, `aria-label="Navigation"` | Client component with `useMediaQuery` |
| **Topbar** | Nav | Header bar for breadcrumbs, user menu, search trigger | Semantic `<header>` | Server w/ client client-side interactions |
| **Table** | Data display | Sortable, selectable, paginated; header sticky on scroll | ARIA table semantics, keyboard nav | Headless wrapper + styled row/cell components |
| **FilterBar** | Data control | Multi-select, search, saved views; URL-driven state | `aria-label`, `aria-expanded` for popovers | Client component, manages `?filters=…` |
| **Badge** | Indicator | Status/tag with optional icon; semantic color + text | `aria-label` for icon-only variants | Styled `<span>` or `<div>` component |
| **Timeline** | Activity | Vertical list of timestamped events | `<ol>` or `<ul>` with `<li>` items, `<time>` elements | Semantic HTML wrapper |
| **CommandBar** | Navigation | Global search/action palette; keyboard-triggered (Cmd+K / Ctrl+K) | Full keyboard nav, focus management | Client component w/ Portal, `useEffect` for hotkey |
| **Modal** | Overlay | Centered dialog with backdrop; focus trap, close on ESC | `role="dialog"`, `aria-modal="true"`, `aria-labelledby` | Use native `<dialog>` or accessible primitive (Radix Dialog, etc.); verify focus management per WCAG. Hand-built focus trap only if primitive unavailable. |
| **Drawer** | Overlay | Slide-in panel (side or bottom); focus trap, close on ESC | `role="dialog"`, `aria-labelledby`, `aria-describedby` | Use accessible primitive or native `<dialog>` with CSS transform; test focus management. |
| **Form** | Input group | Label + input + error/hint text; focus styles, validation states | `aria-describedby`, `aria-invalid`, `aria-label` | Controlled field wrapper component |
| **Button** | Action | Variants: primary, secondary, ghost, danger, icon | `aria-busy` for async, `aria-disabled` for disabled state | Polymorphic component (`as="button" \| "a"` etc.) |
| **Confirmation** | Dialog | Prompt user before destructive action | Modal w/ two buttons (cancel/confirm); focus on cancel | Wrapper around Modal |
| **Chart** | Data viz | KPI cards, bar/line/funnel charts; tooltip on hover | `aria-label` on custom SVG, data table fallback | Wrapper component w/ optional canvas/SVG |
| **Toast** | Feedback | Transient notification; auto-dismiss or manual | `role="alert"` or `role="status"`, `aria-live="polite"` | Portal component, autohide via `useEffect` + timeout |
| **Banner** | Feedback | Persistent alert (info, warning, error, success); optional dismiss | `role="banner"` or inline, no auto-dismiss | Styled container w/ optional close button |
| **Skeleton** | Placeholder | Loading placeholder; animation pulse | `aria-busy="true"` on parent, no interactive content | CSS animation loop on `.skeleton` class |
| **EmptyState** | Placeholder | No data message + optional action | Semantic heading + text | Styled `<div>` container |
| **ErrorFallback** | Error boundary | Error message + retry action | Heading + description + button | Client error boundary component |

### 1.3 Component Composition & Accessibility Strategy

#### Composition Patterns

1. **Server + Client Boundary:**
   - Server layouts (AppShell, Topbar, Sidebar navigation links)
   - Client interactivity (filter controls, table sorting, modal triggers)
   - Hybrid: server fetches data, client renders interactive wrapper

2. **Slots & Polymorphism:**
   - Button: `<Button as="a" href="…">` or `<button onClick={…}>`
   - Card: flexible layout via `children` slots
   - Modal: named slots for header, body, footer

3. **Composition Example:**

   ```typescript
   // Server
   export const Dashboard = async () => {
     const leads = await fetchLeads();
     return <AppShell><PipelineSection leads={leads} /></AppShell>;
   };

   // Client (in PipelineSection)
   'use client';
   const PipelineSection = ({ leads }) => {
     const [filters, setFilters] = useState({});
     return (
       <>
         <FilterBar onFilterChange={setFilters} />
         <Table data={leads} filters={filters} />
       </>
     );
   };
   ```

#### Accessibility Built-In

- **WCAG 2.2 AA compliance** for all components
- **Color contrast:** minimum 4.5:1 for text (semantic colors already meet this)
- **Focus management:** visible focus outline (2px, 2px offset), keyboard nav trap in modals
- **Screen reader:** semantic HTML + ARIA labels, live regions for dynamic content
- **Motor:** min 44×44px touch targets, no keyboard traps, no auto-play
- **Reduced motion:** `@media (prefers-reduced-motion: reduce)` disables animations

### 1.4 Responsive Design & Mobile-First Strategy

#### Breakpoints (CSS media queries, no breakpoint lib needed)

```css
/* Mobile-first approach */
/* 0–639px: Mobile (single column, stack UI) */
/* 640–1023px: Tablet (2-column layouts, optimized touch) */
/* 1024px+: Desktop (full UI, multi-column grids) */

@media (min-width: 640px) { /* tablet */ }
@media (min-width: 1024px) { /* desktop */ }
```

#### Mobile Adaptations

- **Sidebar:** Collapse to drawer on mobile (hamburger menu)
- **Table:** Horizontal scroll on mobile, or card-stack view with key fields
- **Modal:** Full-screen or bottom sheet on mobile
- **Filters:** Collapse into drawer on mobile
- **Forms:** Stack fields vertically, 100% width inputs

#### Touch Targets
- Minimum 44×44px (WCAG) for all interactive elements
- 8px padding around text links
- Avoid small icon buttons; pair with text or enlarge

---

## 2. Responsive & Accessibility Requirements

### 2.1 WCAG 2.2 AA Compliance Checklist

| Criterion | Implementation |
|---|---|
| **1.4.3 Contrast (Minimum)** | All text ≥4.5:1 (or 3:1 for large text). Verify with aXe DevTools. |
| **1.4.5 Images of Text** | Avoid; use real text + CSS instead. |
| **1.4.11 Non-Text Contrast** | UI components ≥3:1 (borders, focus outlines). |
| **1.4.13 Content on Hover/Focus** | Dismissible (ESC), persistent until user action, no pointer traps. |
| **2.1.1 Keyboard** | All UI operable via keyboard (Tab, Enter, Arrow keys, ESC). |
| **2.1.2 No Keyboard Trap** | Focus can leave all components (except intentional modals w/ focus trap). |
| **2.1.4 Character Key Shortcuts** | No single-character shortcuts (Cmd+K OK; single 'K' not OK). |
| **2.4.3 Focus Order** | Logical, predictable, no DOM/visual order mismatch. |
| **2.4.7 Focus Visible** | 2px solid outline (current: present on buttons, nav links, form inputs). |
| **3.2.1 On Focus** | No unexpected context switches when element receives focus. |
| **3.3.1 Error Identification** | Form errors linked to field via `aria-describedby`, color + text. |
| **3.3.4 Error Prevention** | Confirmation for destructive actions (delete, approve, cancel). |
| **4.1.2 Name, Role, Value** | All controls have accessible name, role, and state. Use semantic HTML + ARIA. |
| **4.1.3 Status Messages** | Dynamic updates announced via `aria-live`, `role="status"` / `role="alert"`. |

### 2.2 Keyboard & Focus Management

**Built-in to all components:**

- **Tab navigation:** logical tab order (source order), skip links for landmark jumps
- **Focus visible:** `outline: 2px solid var(--color-accent); outline-offset: 2px;`
- **Escape key:** closes modals, drawers, popovers
- **Enter/Space:** activates buttons, toggles checkboxes
- **Arrow keys:** table column sort, filter option selection, command palette navigation
- **Cmd+K / Ctrl+K:** opens global command bar

### 2.3 Screen Reader Support

- **Semantic HTML:** `<button>`, `<input>`, `<nav>`, `<main>`, `<h1>-<h6>`, `<table>` where appropriate
- **ARIA labels:** `aria-label` for icon-only buttons, `aria-labelledby` for modal titles
- **Live regions:** `<div aria-live="polite" role="status">` for form errors, toast notifications
- **Data tables:** `<thead>`, `<tbody>`, `<th scope="col">`, `<td headers="…">`
- **Images:** descriptive `alt` text (if any; mostly CSS/SVG icons)
- **Form fields:** `<label for="fieldId">` linked to input, `aria-describedby` for error/hint

### 2.4 Reduced Motion

```css
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0ms !important;
    transition-duration: 0ms !important;
  }
}
```

All motion is non-essential; content is still accessible without animations.

### 2.5 Target Size & Mobile Alternatives

- **Touch targets:** 44×44px minimum (WCAG AAA is 48×48px); padding adds to hit area
- **Hover states:** include focus states for keyboard users
- **Mobile table:** card stack layout or horizontal scroll with sticky first column
- **Overflow:** scrollable areas have visible scrollbar, keyboard scroll (arrow keys)

---

## 3. Technical Plan: Next.js 16 App Router & Current Repo Architecture

### 3.1 Current Stack & Constraints

**From `package.json` (sales-automation/):**
- Next.js 16.2.10 (App Router only, no Pages router)
- React 19.2.4 (latest, hooks-based, no class components)
- TypeScript 5 (strict mode)
- Drizzle ORM 0.44.2 (Postgres RLS, `withTenant` context)
- Postgres 3.4.7 driver
- No UI library (Tailwind, shadcn, Radix) — using custom CSS + tokens
- No icon library — import SVG directly or use Unicode

**From `next.config.ts`:**
- `output: "standalone"` (self-contained server bundle)
- Security headers (CSP, HSTS, X-Frame-Options)
- `next-intl` for i18n (German primary)

**From `src/styles/`:**
- **No Tailwind:** use CSS custom properties + BEM-like utility classes
- **No CSS-in-JS:** plain CSS files + inline `style` attributes (CSP allows 'unsafe-inline')
- **No Sass/LESS:** plain CSS with variables

### 3.2 Server/Client Boundary Strategy

**Goal:** Maximize server-side rendering (data fetching, auth checks) while keeping interactive components client-side.

#### Server Components (by default)

- **Layouts:** `RootLayout`, `InternalLayout`, page layouts
- **Data fetching:** queries, aggregations (auth-guarded via `getSession()` + `withTenant`)
- **Navigation:** static links, breadcrumbs
- **Forms:** server-side action handlers (`'use server'`)

#### Client Components (`'use client'`)

- **Interactive tables:** sorting, filtering, pagination (URL-driven state)
- **Modals/Drawers:** state management, animations
- **Forms with real-time validation:** client-side feedback
- **Sidebar toggle:** mobile hamburger menu
- **Command bar:** keyboard shortcuts, search
- **Toast/Banner:** dismissal, auto-hide

#### Hybrid (Server -> renders -> Client)

```typescript
// Server: fetches data
export const PipelineSection = async () => {
  const leads = await fetchLeads(); // withTenant, auth-checked
  return <PipelineClient leads={leads} />;
};

// Client: interactive wrapper
'use client';
const PipelineClient = ({ leads }) => {
  const [filters, setFilters] = useState({});
  return <Table data={leads} filters={filters} />;
};
```

### 3.3 URL-Driven State (Next.js Search Params)

**All mutable UI state → URL query strings** (enables sharing, browser back/forward, bookmarking).

```
/pipeline
  ?status=new,qualified
  &sort=created
  &dir=desc
  &page=1
  &search=mueller
```

### 3.4 Component Organization

```
src/
├── app/
│   ├── (internal)/
│   │   ├── layout.tsx                 // Shell + Sidebar
│   │   ├── pipeline/
│   │   │   └── page.tsx               // Server: fetches leads
│   ├── auth/
│   │   └── sign-in/
│   │       └── page.tsx
│   └── layout.tsx                     // Root
├── components/
│   ├── internal/                      // Internal app UI
│   │   ├── AppShell.tsx               // Server layout wrapper
│   │   ├── Sidebar.tsx                // Client drawer + nav
│   │   ├── Topbar.tsx                 // Server + client (logo, user menu)
│   │   ├── Table.tsx                  // Client (sortable, filterable)
│   │   ├── FilterBar.tsx              // Client (multi-select, search)
│   │   ├── Button.tsx                 // Pure component
│   │   ├── Modal.tsx                  // Client (portal, focus trap)
│   │   ├── Drawer.tsx                 // Client (portal, animation)
│   │   ├── Form.tsx                   // Client (validation, errors)
│   │   ├── CommandBar.tsx             // Client (global search/actions)
│   │   ├── Toast.tsx                  // Client (portal, auto-hide)
│   │   ├── Banner.tsx                 // Server or client
│   │   ├── Timeline.tsx               // Pure component
│   │   ├── Skeleton.tsx               // Pure component (animated pulse)
│   │   ├── EmptyState.tsx             // Pure component
│   │   └── ErrorFallback.tsx          // Client (error boundary)
│   └── ui/                            // Shared, reusable utilities
│       ├── Icon.tsx                   // Wrapper for SVG icons
│       └── Link.tsx                   // Next.js Link wrapper
├── modules/                            // Feature logic (existing)
├── styles/
│   ├── global.css                     // Base + component utilities (extend)
│   └── tokens.css                     // Design tokens (no changes)
└── lib/
    ├── server/                        // Server-only utilities
    └── client/                        // Client-only utilities
```

### 3.5 Token & Tailwind Strategy (✅ Owner Decision Approved)

**Owner Decision Approved:** Incremental Tailwind adoption mapped to semantic CodeKessel design tokens. Preserve existing CSS during migration; no big-bang rewrite. No gradients by default. Use official brand values once supplied.

Current system uses custom CSS properties (tokens.css, 55 lines semantic tokens) + BEM-like utility classes (global.css, 1,148 lines). Tailwind adoption approved to accelerate component development.

**Phase 0 Implementation Spike (Architecture Validation — Not Decision Spike):**
- Map Tailwind classes to existing token values (colors, spacing, font sizes)
- Document config/token mapping, coexistence strategy, purge/content paths, regression strategy
- Measure bundle impact against the current production build and agree an acceptable budget from evidence; do not use an arbitrary percentage gate.
- Test interoperability (old CSS + new Tailwind class name conflicts)
- Define migration sequence: new components first, incremental adoption, parallel coexistence
- Outcome: Approved implementation approach for Phase 1 component development

**Timeline:** Phase 0 architecture validation completes decision; Phase 1 component development proceeds with Tailwind.

### 3.6 Hydration & Timezone Safety

**Issue:** SSR can produce mismatches if client code initializes from browser time.

**Solution:**
- Avoid `new Date()` in component render; use in `useEffect` only
- Use ISO strings for timestamps
- Create `<TimezoneProvider>` that reads browser timezone on mount

### 3.7 Loading / Error / Not-Found Boundaries

**Next.js App Router built-in:** `loading.tsx`, `error.tsx`, `not-found.tsx` per route segment.

**Files created per segment:**
```
src/app/(internal)/
├── loading.tsx           // Skeleton shell
├── error.tsx             // Error fallback
├── not-found.tsx         // 404 page
├── layout.tsx            // Shell
├── pipeline/
│   ├── loading.tsx       // Table skeleton
│   ├── error.tsx         // Fetch error fallback
│   └── page.tsx          // Data page
```

### 3.8 Data Fetching & Performance Strategy

**Current operational constraint:** All operational pages use `export const dynamic = "force-dynamic"` (no caching by default). Tenant-specific data, user-scoped queries, and real-time state require fresh server renders.

**Strategy:**

1. **Default: Dynamic rendering** — `export const dynamic = "force-dynamic"` for tenant/user-specific data
   - Pipeline/leads/tasks/outbox pages (user-scoped, real-time status)
   - Authenticated routes (session-guarded, tenant-isolated)
   - Reason: Prevents stale data and cross-tenant leakage; simple SSR model

2. **Server component data fetching:**
   - Fetch in server component: `const data = await fetchLeads()`
   - Pass to client: `<PipelineClient data={data} />`
   - Client interactivity: sorting, filtering via URL params (no re-fetch on local sort)

3. **Explicit caching (exceptions only):**
   - Identify carefully: aggregates with no tenant/user variance (e.g., global settings, static config)
   - Use `export const revalidate = N` with validation
   - Plan invalidation strategy on mutations: `revalidatePath('/path')` or `revalidateTag('key')`
   - Test: verify no cross-user leakage or race conditions on concurrent mutations

4. **Post-mutation patterns:**
   - Redirect after server action: `redirect('/path')` (triggers fresh render, clean URL)
   - Or: explicit `revalidatePath()` + return fresh data to client
   - Never rely on client-side refresh for authorization boundaries

5. **Preventing N+1 queries:**
   - Use Drizzle's `left_join()` for related data
   - Batch queries with Promise.all()
   - Validate tenant isolation at DB layer (RLS enforced in `withTenant`)

### 3.9 Dependency Justification: Accessible Primitives (✅ Owner Decision Approved)

**Owner Decision Approved:** Native semantic elements first; use Radix primitives for complex dialog/popover/menu/select/tooltip interactions where native behavior is insufficient. Style with Tailwind/semantic tokens; do not adopt generic visual defaults. Phase 0 dependency/bundle check = implementation validation, not open product choice.

| Tool | Status | Notes |
|---|---|---|
| **Tailwind CSS** | ✅ Approved | Phase 0 implementation spike for config/token mapping |
| **Accessible Primitives (Radix, Headless UI, etc.)** | ✅ Approved (native first) | Use native elements first (`<dialog>`, `<select>`, `<details>`); evaluate Radix for complex interactions (combobox, advanced select, popover). Bundle/accessibility trade-off analysis in Phase 0. Do not hand-build focus traps/dialog/select by default. |
| **shadcn/ui** | Suitable post-decision | Can be evaluated after Tailwind + primitives choices finalized. Depends on styling approach; defer until 3.5 & accessible primitives decision complete. |
| **React Query / SWR** | Not needed currently | Dynamic Server Components and URL-driven state are the baseline. Revisit only if a measured workflow requires client polling or optimistic updates. |
| **Zustand / Redux** | Not needed | URL-driven state (search params) preferred for UI state; no client persistence required. |
| **date-fns / Day.js** | Not needed | `Intl.DateTimeFormat` + native Date sufficient; no user input date parsing in scope. |

---

## 4. Phased Migration & Rollback

### 4.1 Migration Phases Overview

| Phase | Rough range (planning only) | Focus | Suggested accountable role |
|---|---|---|---|
| **Phase 0** | Small, estimate after technical design | P1 blockers, authorization/schema design, token verification, brand approval | Product + Tech lead |
| **Phase 1** | Medium, estimate after approved component designs | Shell & design-system foundation | Frontend lead |
| **Phase 2** | Medium–large, estimate per workflow slice | Pipeline, Leads, Tasks, Outbox pages | Frontend + Feature team |
| **Phase 3** | Medium–large, estimate per workflow slice | Documents, Applications, Import, Manager panel | Feature team |
| **Phase 4** | Medium, driven by measured gaps | Responsive polish, measured performance, accessibility audit | Design + Frontend |

**Total:** Must be estimated after Phase 0, approved designs, team capacity, representative-data measurements and accessibility scope are known.

### 4.2 Phase 0: Brand & Token Verification + PR-Readiness Blockers

**Duration:** Estimate after the atomic-send and authorization designs are reviewed.  
**Suggested accountable roles:** Product + Tech lead  
**Acceptance:** Tokens finalized, P0/P1 blockers fixed


**Tasks:**
1. [ ] Fix P1-1: Atomic compare-and-set in `approveAndDispatch` (lines 147–154 of `src/modules/messaging/outbox.ts`)
   - Add `AND status='pending_approval'` to UPDATE WHERE clause
   - Check RETURNING to detect lost race
   - File: `src/modules/messaging/outbox.ts`
2. [ ] Fix P1-2: CI pnpm version (`.github/workflows/ci.yml`, line 10–11)
   - Add `version: 10` to `pnpm/action-setup@v4`
   - File: `.github/workflows/ci.yml`
3. [x] **Owner Decisions Documented:**
   - Role model: 3 roles (consultant, manager, admin) ✅
   - Manager panel: Planned Phase 1+ ✅
   - Record visibility: Assigned + team pool ✅
   - Message approval: Separation of duties ✅
   - Styling: Incremental Tailwind + tokens ✅
   - Accessible primitives: Native + Radix where needed ✅
   - Kanban: Optional Phase 2+ ✅
   - Outbox history: Phase 2+ ✅
   - Dark mode: NOT required (closed) ✅
4. [ ] **Phase 0 Architecture Spikes:**
   - CSS/Tailwind config mapping (implementation architecture validation)
   - Accessible primitives bundle/a11y analysis
   - Consultant record ownership queries (safe claim/reassignment rules)
   - Message-author schema changes (created_by field)
5. [ ] Verify design token palette (no code changes to tokens.css yet)
6. [ ] Document component spec (Table, Filter, Badge, Modal, etc.)
7. [ ] Set up design review process
8. [ ] Brand-Asset-Intake Checkliste starten

**Expected implementation files (not modified by this plan):**
- `.github/workflows/ci.yml` (pnpm version fix)
- `src/modules/messaging/outbox.ts` (P1-1 atomic guard fix)
- `docs/crm-redesign/*.md` (owner decisions recorded)

**Deliverables:**
- Owner decisions documented (this document)
- Phase 0 spike summaries: CSS/Tailwind decision, primitives analysis, message-author schema design
- Approved component spec (Section 1.2)
- Design review process documented

**Rollback:** Implement each blocker/schema change in a small reviewed PR with focused tests and an explicit rollback/migration plan. Do not merge directly from planning documentation.

---

### 4.3 Phase 1: Shell & Design System Foundation

**Initial size:** Medium; forecast after Phase 0.  
**Suggested accountable role:** Frontend lead  
**Acceptance:** All new components in demo page, WCAG AA pass

**15+ PR slice tasks:**
1. PR 1.1: Extend design tokens with z-index, transitions (20 lines to `tokens.css`)
2. PR 1.2: AppShell, Sidebar, Topbar layout components
3. PR 1.3: Button and Badge components
4. PR 1.4: Form, Input, Select components with validation
5. PR 1.5: Modal and Drawer components with focus trap
6. PR 1.6: Toast and Banner components
7. PR 1.7: Table component foundation (sortable, selectable)
8. PR 1.8: FilterBar component (multi-select, search, URL state)
9. PR 1.9: Timeline and Activity components
10. PR 1.10: Skeleton, EmptyState, ErrorFallback components
11. PR 1.11: CommandBar component (Cmd+K global search)
12. PR 1.12: Icon and Link wrapper components
13. PR 1.13: Demo page `/demo/components` showcasing all components
14. PR 1.14: Accessibility tests (aXe, keyboard nav, ARIA)
15. PR 1.15: Documentation and TypeScript types

**Files created:**
- `src/styles/tokens.css` (extend, add z-index/transition scales)
- `src/styles/global.css` (extend with new component classes)
- `src/components/internal/*.tsx` (15+ new files)
- `src/styles/components/skeleton.css` (new animations)
- `docs/DESIGN-SYSTEM.md` (new documentation)
- `tests/unit/components/*.test.ts` (new tests)

**Rollback:** Revert Phase 1 PR; old components still available unchanged

---

### 4.4 Phase 2: Pipeline, Leads, Tasks, Outbox

**Owner:** Frontend lead + feature team

**5–8 PR slice tasks:**
1. PR 2.1: Migrate `/pipeline` page to new Table + FilterBar
2. PR 2.2: Migrate `/leads/[id]` page to new Modal + Form
3. PR 2.3: Migrate `/leads` list page
4. PR 2.4: Migrate `/tasks` page
5. PR 2.5: Migrate `/outbox` page with confirmations
6. PR 2.6: Keyboard navigation integration tests
7. PR 2.7: Mobile responsive refinements
8. PR 2.8: Integration tests (data-driven)

**Files modified:**
- `src/app/(internal)/pipeline/page.tsx` (+ loading.tsx, error.tsx)
- `src/app/(internal)/leads/*.tsx` (multiple pages)
- `src/app/(internal)/tasks/*.tsx`
- `src/app/(internal)/outbox/*.tsx`

**Rollback:** Revert Phase 2 PR

---

### 4.5 Phase 3: Documents, Applications, Import, Manager Panel

**Owner:** Feature team

**6 PR slice tasks — similar structure to Phase 2:**
1. PR 3.1–3.6: Migrate `/documents`, `/applications`, `/reports`, `/leads/import`, `/employers` pages
   - Each page: table + detail modal/drawer + filters + forms
   - All use new components from Phase 1
   - Keyboard nav tested, mobile responsive

**Rollback:** Revert Phase 3 PR

---

### 4.6 Phase 4: Analytics, Responsive Polish, Final Audit

**Owner:** Design + Frontend

**4 PR slice tasks:**
1. PR 4.1: Analytics events for component interactions
2. PR 4.2: Mobile device testing and refinements
3. PR 4.3: Reduced motion + performance optimization (Lighthouse ≥90)
4. PR 4.4: Full WCAG 2.2 AA audit + final docs

**Rollback:** Revert Phase 4 PR

---

### 4.7 Rollback Strategy

**Each phase is merged independently to main.**

**Phase 0 rollback:**
- `git revert <commit>` (P1-1 & P1-2 fixes are surgical, safe)

**Phases 1–4 rollback:**
- Safe if component APIs and page patterns unchanged during later phases
- Component files are additive (new files + extended CSS); old classes remain
- `git revert <PR-merge-commit>`
- Old component imports still work if imports not refactored later
- **Caveats:**
  - URL query string contracts (e.g., `?status=…&sort=…`) must be maintained if UI expects them. Breaking URL schema requires client-side migration or deprecation period.
  - Component props/slots/events: if later phases depend on new props added in Phase 1, reverting Phase 1 breaks Phase 2+. Use feature flags or parallel component versions to mitigate.
  - Page state machines: if Phase 2+ refactor loading/error boundaries, rollback may leave stale error states. Test rollback on staging first.

**Data safety:**
- No data migrations in any phase (presentation-only)
- No schema changes
- Database unchanged
- Authorization checks (RLS, session guard) unchanged

**Recommended rollback approach:**
- Single-phase rollback: `git revert -m 1 <merge-commit>` (safe; tests catch regressions)
- Multi-phase rollback: If Phase 3+ depends on Phase 1–2 changes, revert in reverse order and test after each revert
- Consider release flags for major component rewrites: keep old + new implementation side-by-side, route via flag

**Example:**
```bash
# If Phase 2 breaks pipeline page
git revert -m 1 <Phase-2-merge-commit>
# Test: old pipeline imports still work
# Test: old CSS classes still render
# Database queries unchanged
# Check: URL params still respected (?status=…&sort=…)
```

---

### 4.8 Acceptance Gates

| Phase | Gate | Criteria |
|---|---|---|
| **Phase 0** | P1 blockers + tokens | `approveAndDispatch` race fixed, pnpm pinned, tokens approved |
| **Phase 1** | Components in demo | All 15+ components render, aXe 0 violations, keyboard nav works, ≥80% coverage |
| **Phase 2** | Pipeline + leads live | Table sorts/filters, URL state persists, no visual regressions |
| **Phase 3** | Documents + admin live | All pages migrated, forms work, no 404s |
| **Phase 4** | Mobile + accessibility | Lighthouse ≥90, responsive, screen reader audit pass |

---

## 5. Mandatory Pre-UI Blockers (from LOGIC-PR-READINESS-REVIEW.md)

### P1-1: Atomic Compare-and-Set in `approveAndDispatch`

**File:** `src/modules/messaging/outbox.ts` (lines 147–154)  
**Issue:** Race condition on double-click → double-send WhatsApp message

**Current (vulnerable):**
```typescript
// Line 147–154: SELECT without status guard
const message = await tx.select().from(outboundMessages)
  .where(and(
    eq(outboundMessages.id, params.messageId),
    eq(outboundMessages.tenantId, params.tenantId),
  )).limit(1);

// Line 147–154: Separate UPDATE missing WHERE status check
await tx.update(outboundMessages).set({
  status: "sending",
  approvedByUserId: params.approvedByUserId,
  approvedAt: now,
}).where(eq(outboundMessages.id, params.messageId)); // ← No status guard!
```

**Fixed:**
```typescript
// Atomic UPDATE with status guard
const [locked] = await tx.update(outboundMessages).set({
  status: "sending",
  approvedByUserId: params.approvedByUserId,
  approvedAt: now,
}).where(and(
  eq(outboundMessages.id, params.messageId),
  eq(outboundMessages.tenantId, params.tenantId),
  eq(outboundMessages.status, "pending_approval"), // ← KEY: atomic guard
)).returning({ id: outboundMessages.id });

if (!locked) return { status: "not_pending" }; // Concurrent request lost race
```

**Test needed:** Integration test with two concurrent `approveAndDispatch` calls; `adapter.send` called exactly once.

**Acceptance:** Test passes, adapter.send called 1× even on double-click.

---

### P1-2: Deterministic pnpm Version in CI

**File:** `.github/workflows/ci.yml` (lines 10–11)  
**Issue:** `pnpm/action-setup@v4` has no version; may fail or use non-deterministic version

**Current (fragile):**
```yaml
- name: Setup pnpm
  uses: pnpm/action-setup@v4
  # Missing: version: parameter or packageManager in package.json
```

**Fixed:**
```yaml
- name: Setup pnpm
  uses: pnpm/action-setup@v4
  with:
    version: 10  # Match local pnpm version
```

**Acceptance:** CI passes on first push, pnpm version deterministic.

---

### P2 Blockers (Fix Before or After Phase 0)

| Issue | File | Fix | Impact |
|---|---|---|---|
| **P2-1: `approved` dead state** | `src/modules/messaging/outbound-status.ts` | Remove `approved` intermediate or two-step approve/dispatch | Planning only |
| **P2-2: Missing `updated_at` updates** | `src/modules/messaging/outbox.ts` (L147, L194, L263, L319) | Add `updatedAt: new Date()` to all UPDATEs | Before ship |
| **P2-3: Cancel button not wired** | `src/app/(internal)/outbox/page.tsx` | Add UI button or document API-only | Phase 2 (outbox redesign) |
| **P2-4: HTTP in transaction** | `src/modules/messaging/outbox.ts:180` | Move `adapter.send()` outside transaction (post-MVP) | Planning only |
| **P2-5: `tsx` in devDeps** | `Procfile:3`, `package.json` | Move `tsx` to dependencies | Before ship |
| **P2-6: `TRUST_PROXY` not forwarded** | `docker-compose.yml` | Add `TRUST_PROXY: ${TRUST_PROXY:-}` | Before ship |

---

## 6. Scope, Non-Goals & Open Decisions

### Non-Goals (Out of Initial CRM Redesign Scope)

1. **Backend API redesign** — Not in scope; focus on frontend UI/UX with existing APIs
2. **Database schema changes** — CRM uses existing `tasks`, `participants`, `outbound_messages` tables; schema stable
3. **Storybook or design tokens sync** — Demo page `/demo/components` sufficient; manual token updates acceptable
4. **End-to-end animations** — Micro-interactions only (fade, slide); no complex motion
5. **i18n for component labels** — English labels in component layer; translation in `messages/de.json`
6. **Third-party analytics in components** — Analytics on page routes only, not component-level
7. **Offline-first / PWA** — Not in scope
8. **Real-time collaboration UI** — Not in scope
9. **Internationalized date/number formatting** — Use `Intl.DateTimeFormat` for display; no date parsing user input in scope

### Partially Open / Deferred

1. **Dark mode** — ✅ Approved NOT required. Mark as post-launch non-goal. Closed decision — not open.

2. **CSS-in-JS vs. CSS tokens vs. Tailwind** — ✅ Approved Tailwind. Phase 0 implementation spike → config/token mapping, coexistence, purge/content paths, regression strategy.

3. **Icon library** — Currently: inline SVG or Unicode. Evaluate `lucide-react` or `heroicons` if icon management burden increases. Do not pre-add icon library.

4. **Consultant record ownership enforcement** — ✅ Approved: assigned records + team pool. Phase 0 backend work required (query scopes, claim/reassignment rules, audit events).

### Owner Decisions & Open Questions (All Approved ✅)

| Question | Accountable Role | Status | Notes |
|---|---|---|---|
| **Role model (3 vs 2)** | Product lead | ✅ Approved: 3 roles (consultant, manager, admin) | No separate operations role; operations use manager permissions |
| **Manager panel** | Product lead | ✅ Approved Planned Phase 1+ | Tenant-wide team pipeline, lead aging, consultant workload, task SLA, etc. |
| **Record visibility** | Product lead | ✅ Approved: assigned + team pool | Consultants see assigned + unassigned pool (claim); managers/admins see all |
| **Message approval** | Product lead | ✅ Approved: separation of duties | Creator cannot approve own; one approver sufficient; system-messages also require approval |
| **CSS/Tailwind strategy** | Tech lead + Design lead | ✅ Approved: Tailwind + semantic tokens | Phase 0 implementation spike → config/mapping/coexistence |
| **Accessible primitives** | Tech lead | ✅ Approved: native first, Radix for complex | Phase 0 bundle/a11y analysis; hand-built focus traps avoided |
| **Kanban view** | Product lead | ✅ Approved Planned Phase 2+ | Optional secondary view; no drag-drop in Phase 1 |
| **Outbox history** | Product lead | ✅ Approved: Pending + History views | Phase 2+ after backend state verification |
| **Dark mode** | Product lead | ✅ Approved Excluded | NOT required; closed decision — not open |
| **WCAG 2.2 AA vs. AAA** | Product lead | Confirmed: AA target (section 2.1) | AAA deferred unless priority |
| **Keyboard shortcuts (Cmd+K)** | Product lead | Proposed: CommandBar approved | Power-user efficiency for internal CRM |
| **Lighthouse gates** | Tech lead | Clarified ≥90 diagnostic | Not sole a11y proof; manual review required (keyboard + screen reader + checklist) |

---

## 7. Detailed Implementation Backlog Summary

### Phase 1: Foundation PR slices

| PR | Title | Scope |
|---|---|---|
| 1.1 | Extend design tokens | Z-index, transitions, responsive scales |
| 1.2 | AppShell, Sidebar, Topbar | Layout foundation |
| 1.3 | Button, Badge | Core UI components |
| 1.4 | Form, Input, Select | Form controls |
| 1.5 | Modal, Drawer | Overlays w/ focus trap |
| 1.6 | Toast, Banner | Feedback components |
| 1.7 | Table | Data display (sortable, selectable) |
| 1.8 | FilterBar | Multi-faceted filters + URL state |
| 1.9 | Timeline, Activity | Activity log components |
| 1.10 | Skeleton, EmptyState, ErrorFallback | Placeholder/error states |
| 1.11 | CommandBar | Global search/action palette (Cmd+K) |
| 1.12 | Icon, Link | Utility wrappers |
| 1.13 | Demo page | `/demo/components` showcase |
| 1.14 | a11y tests | aXe, keyboard nav, ARIA |
| 1.15 | Docs, types | Design system documentation |

---

### Phase 2: Core-workflow PR slices

| PR | Title | Pages |
|---|---|---|
| 2.1 | Migrate pipeline | `/pipeline` → new Table + FilterBar |
| 2.2 | Migrate lead detail | `/leads/[id]` → new Modal + Form |
| 2.3 | Migrate leads list | `/leads` → new components |
| 2.4 | Migrate tasks | `/tasks` → new components |
| 2.5 | Migrate outbox | `/outbox` → new components + confirmations |
| 2.6 | Keyboard nav tests | All Phase 2 pages |
| 2.7 | Mobile responsive | Breakpoints, card stacks, touch targets |
| 2.8 | Integration tests | Data-driven tests for Phase 2 |

---

### Phase 3: Supporting-workflow PR slices

Similar to Phase 2; migrate:
- `/documents` + `/documents/[participantId]`
- `/applications`
- `/reports`
- `/leads/import` (admin)
- `/employers` (admin)
- Any other admin pages

---

### Phase 4: Validation and polish PR slices

| PR | Title | Focus |
|---|---|---|
| 4.1 | Analytics events | Track component interactions |
| 4.2 | Mobile polish | Device testing, refinements |
| 4.3 | Perf + reduced motion | Lighthouse ≥90, animations disabled |
| 4.4 | Full a11y audit | aXe 0 violations, final docs |

---

## 8. Success Criteria & Timeline

### Success Metrics

| Metric | Target | Verification | Notes |
|---|---|---|---|
| **WCAG 2.2 AA Compliance** | 0 violations on manual audit | aXe DevTools (automated) + manual keyboard nav + screen reader test (NVDA, JAWS, or VoiceOver) | Lighthouse accessibility score ≥90 useful diagnostic but not sole proof. Manual review required. |
| **Keyboard Navigation** | 100% of UI operable | Tab through all pages, test Enter/Space/ESC/Arrow keys, verify no traps | Manual testing; document any intentional traps (modal focus trap). |
| **Mobile Responsive** | All breakpoints functional | Chrome DevTools device mode + real device testing (iOS Safari, Android Chrome) | 3 breakpoints: 0–639px, 640–1023px, 1024px+. Test table overflow, modal full-screen, sidebar drawer. |
| **Bundle Size** | Budget established from Phase 0 baseline | Production build analysis selected during the Tailwind/Radix validation | Compare representative routes and document the agreed budget before implementation. |
| **Lighthouse** | Baseline recorded; material regressions investigated | Lighthouse in an agreed production-like environment | Diagnostic only; not sufficient for accessibility. Combine with manual review. |
| **Test Coverage** | Critical component and workflow behavior covered | Existing `node:test` unit suite + Playwright + focused integration tests | Agree any numeric threshold only after a baseline; do not introduce Jest solely for this redesign. |
| **P1 Blockers** | Both fixed and independently verified | Focused concurrency/CI tests before any UI redesign PR depends on them | P1-1 (atomic approval CAS) + P1-2 (pnpm determinism). |
| **Pages Migrated** | 100% (all operational pages) | No un-migrated legacy components in production routes | By Phase 4 end; Phase 0–3 migrations followed by Phase 4 polish. |

### Estimation approach

Do not commit to calendar dates from this plan. Estimate each reviewable slice after Phase 0 has produced:

- approved brand assets and component designs;
- the authorization/schema design for consultant, manager and admin;
- the message-author and atomic-approval design;
- a production-like performance and bundle baseline;
- named delivery capacity and review availability.

Use relative sizing first:

| Phase | Initial size | Main uncertainty |
|---|---|---|
| **Phase 0** | Medium | Concurrency fix, role/auth migration, claim rules, message-author schema |
| **Phase 1** | Medium | Tailwind coexistence, primitives, component design approval |
| **Phase 2** | Large | Core workflow migration and operator validation |
| **Phase 3** | Large | Manager panel and document/application workflow complexity |
| **Phase 4** | Medium | Findings from responsive, performance and accessibility testing |

Convert these sizes into delivery forecasts only after the team estimates the PR slices. Forecasts must include code review, migration rehearsal, QA, accessibility review, operator acceptance and rework.

### Risk Mitigation

| Risk | Likelihood | Severity | Mitigation |
|---|---|---|---|
| **Breaking existing pages mid-phase** | Assess in Phase 0 | High | Parallel components, focused regression tests, staged rollout |
| **Accessibility defects discovered late** | Assess in Phase 1 | High | Review primitives and keyboard flows in every phase |
| **Performance regression** | Measure from baseline | Medium | Route-level build/runtime measurements and evidence-based loading strategy |
| **Dialog/popover focus behavior fails** | Assess in primitive spike | High | Native behavior first; verified Radix primitives where needed; manual tests |
| **Mobile responsive gaps** | Assess continuously | Medium | Representative device testing every phase |
| **Form validation integration fails** | Assess per workflow | Medium | Preserve server validation and add focused integration tests |

---

## 9. Files & Line References

### Current Implementation References

| File | Lines | Purpose |
|---|---|---|
| `src/styles/tokens.css` | 1–55 | Design tokens (extend in PR 1.1) |
| `src/styles/global.css` | 1–1148 | Component classes (extend Phases 1–4) |
| `src/app/layout.tsx` | 1–24 | Root layout (no change) |
| `src/app/(internal)/layout.tsx` | 1–58 | Internal shell (refactor Phase 2+) |
| `.github/workflows/ci.yml` | 1–40+ | CI workflow (fix pnpm Phase 0) |
| `src/modules/messaging/outbox.ts` | 134–201 | Approval gate (fix P1-1 Phase 0) |
| `package.json` | 1–44 | Dependencies (verify, add packageManager) |

### New Files to Create

**Phase 1 (15+ files):**
- `src/components/internal/{AppShell, Sidebar, Topbar, Table, FilterBar, Button, Badge, Form, Input, Select, Modal, Drawer, Toast, Banner, Timeline, Skeleton, EmptyState, ErrorFallback, CommandBar}.tsx`
- `src/components/ui/{Icon, Link}.tsx`
- `src/styles/components/skeleton.css`
- `docs/DESIGN-SYSTEM.md`
- `tests/unit/components/*.test.ts`

**Phases 2–4:** Loading/error boundaries, component integrations (no new component files)

---

## 10. Verification Checklist (Before Phase 1)

**Complete Phase 0 before Phase 1 implementation:**

- [ ] P1-1 blocker fixed: atomic CAS in `approveAndDispatch`
- [ ] P1-2 blocker fixed: deterministic pnpm version in CI
- [ ] Phase 0 spike: CSS/Tailwind decision approved
- [ ] Phase 0 spike: accessible primitives approach chosen
- [ ] Phase 0 spike: consultant record ownership model decided
- [ ] Component spec approved (Table, Filter, Badge, Modal, Drawer, Form, Toast, Banner, Timeline, Skeleton, EmptyState, ErrorFallback, CommandBar, Button, Badge)
- [ ] Token palette confirmed (colors, typography, spacing, motion; no new tokens needed for redesign)
- [ ] WCAG 2.2 AA compliance target confirmed (manual keyboard + screen reader audit, not just Lighthouse)
- [ ] Mobile breakpoints approved (0–639px, 640–1023px, 1024px+)
- [ ] Server/client boundary strategy agreed (dynamic by default, explicit caching exceptions only)
- [ ] URL-driven state confirmed (filters, sort, pagination in query strings; no local useState for UI control)
- [ ] Rollback strategy understood (per-phase `git revert`; caveats: URL contracts, component deps, state machines)
- [ ] No new npm dependencies approved (or Phase 0 spike analysis completed for Tailwind / Radix)
- [ ] Data fetching pattern confirmed (`export const dynamic = "force-dynamic"` by default; `revalidatePath()` on mutations)
- [ ] Testing strategy defined (unit/integration/accessibility; manual review required)
- [ ] Phase 0 owner + Phase 1 lead assigned
- [ ] PR slices estimated by the named delivery team after Phase 0; no calendar commitment inferred from this plan
- [ ] Success metrics approved (0 WCAG violations after manual review, keyboard nav 100%, mobile responsive, Lighthouse ≥90 diagnostic only)

---

**Document Status:** Phase 0 owner decisions approved; architecture spikes in progress; Phase 1 implementation ready to start
**Next Step:** Complete Phase 0 architecture spikes (Tailwind config, primitives analysis, schema design); execute P1-1 & P1-2 fixes
**Review Cadence:** Phase 0 decisions documented; weekly syncs during Phase 1–4
**Final Audit:** Full WCAG 2.2 AA manual audit (keyboard + screen reader) + Lighthouse diagnostic after Phase 4

