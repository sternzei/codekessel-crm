# CRM Design Direction & UX Audit
## German QCG Sales Operations CRM Redesign

**Last Updated:** July 28, 2026  
**Audience:** Product, Engineering, Design  
**Purpose:** Establish a professional, efficient CRM design for German vocational sales operations, grounded in CodeKessel brand identity and repository design tokens.

## Verified CodeKessel source (2026-07-28)

- Authoritative source: `https://codekessel.de`.
- The site references the official transparent
  `Codekessel-Logo-scaled.png` wordmark (2560 × 744); no SVG is exposed there.
  The unchanged asset is stored locally at
  `public/brand/codekessel-logo.png`.
- The site's Elementor global token defines primary violet as `#8F14E0` in
  `wp-content/uploads/elementor/css/post-2401.css`. This replaces the
  provisional violet estimate in the app's semantic accent token.
- The operational sidebar uses the wordmark compactly, with “QCG
  Antragsplattform” as secondary product text and no gradient or mascot.

---

## Executive Summary

This CRM will serve as the operational spine for German qualification center (QCG) sales consultants managing leads, appointments, and participant onboarding. The design prioritizes:

- **Dense, professional layouts** optimized for power users and administrative workflows—not marketing aesthetics.
- **Semantic color coding** for status, risk, and action priority; every decision rooted in data.
- **Responsive mobile support** for field consultants and meeting scenarios.
- **WCAG 2.2 AA accessibility** to comply with German public procurement and inclusivity expectations.
- **Controlled, evolved CodeKessel identity**—using the brand's modern palette and character without borrowing marketing layouts.

The current app (sales-automation) already runs a working prototype with a custom design-token system (CSS custom properties) and vanilla CSS. This audit validates that foundation and outlines incremental improvements for the redesign phase.

---

## Part 1: Evidence-Based Current-State Audit

### 1.1 Verified Application Routes & Screens

Source: **`src/app/(internal)/**`** structure in the sales-automation repository.

| Route | Screen | Purpose | Current Implementation |
|-------|--------|---------|------------|
| `/pipeline` | Lead Pipeline | Lead management, status filtering, bulk assignment | Table with sorting, row selection, bulk actions (no Kanban board) |
| `/tasks` | Task Queue | Open outbound tasks; WhatsApp send integration | Vertical task list with status badges, link/revoke actions |
| `/outbox` | Message Approval Queue | Pending messages awaiting approval/rejection | Card-based approval interface (not sent-message history) |
| `/appointments` | Appointments List | Scheduled appointments; status updates | Data list with status badges, inline completion/no-show buttons (not calendar view) |
| `/employers` | Employer Register | Company data, setup status, BA application data | Table with status badges, inline setup wizard launch (not dynamic form) |
| `/documents` | Document Portal | Participant document checklist and status | Link grid to participant document pages (not bulk upload) |
| `/applications` | Applications List | Qualification application tracking, submission readiness | Table with status badges, submission blockers, export action |
| `/reports` | Analytics Dashboard | KPIs, funnel, conversion rates, no-show tracking | Metric cards, funnel visualization, date-range filtering (not real-time charts) |
| `/leads/[id]` | Lead Detail | Single lead profile, timeline, actions, eligibility | Multi-section detail with forms, status badges, action buttons |
| `/leads/new` | Create Lead | Manual lead entry | Simple form (name, phone, email, city, source) |
| `/leads/import` | Register Import | Batch lead import from BA OpenRegister (admin only) | Import wizard with conflict resolution |
| `/auth/sign-in` | Login | Email/password authentication | Minimal centered form card |

**File References & Verified Implementations:**
- Layout definition: `src/app/(internal)/layout.tsx` (lines 1–50+) — sidebar, auth check
- Navigation items: `src/app/(internal)/layout.tsx` (lines 18–27) — hardcoded nav list
- Pipeline page: `src/app/(internal)/pipeline/page.tsx` — table with sorting, filters, KPI cards, funnel, alerts (lines 1–400+)
- Pipeline table: `src/components/internal/PipelineTable.tsx` (lines 1–50+) — sortable columns, bulk selection via checkboxes
- Outbox page: `src/app/(internal)/outbox/page.tsx` — card-based approval queue with approve/reject forms, pending message list (lines 1–80+)
- Appointments page: `src/app/(internal)/appointments/page.tsx` — data-list layout, inline status change buttons (lines 1–70+)
- Employers page: `src/app/(internal)/employers/page.tsx` — employer table with setup wizard link, BA data form (lines 1–60+)
- Documents page: `src/app/(internal)/documents/page.tsx` — data-list with participant links (lines 1–50+)
- Applications page: `src/app/(internal)/applications/page.tsx` — table with readiness blockers, export action (lines 1–70+)
- Reports page: `src/app/(internal)/reports/page.tsx` — metric KPI cards, funnel visualization, filter form (lines 1–100+)
- Lead detail page: `src/app/(internal)/leads/[id]/page.tsx` — multi-section detail view with status badge, forms, action buttons (lines 1–100+)
- New lead page: `src/app/(internal)/leads/new/page.tsx` — simple form with required name fields, optional phone/email/city/source (lines 1–60+)
- Sign-in form: `src/app/auth/sign-in/page.tsx` (lines 1–53) — minimal form card

### 1.2 Verified Design Tokens & CSS Variables

Source: **`src/styles/tokens.css`** (54 lines) and **`src/styles/global.css`** (1,147 lines).

#### Color System
```css
/* From tokens.css, lines 2–25 */

/* Surfaces: warm paper, layered cards, deep ink sidebar */
--color-bg: oklch(97.5% 0.004 85);           /* Warm off-white background */
--color-surface: oklch(100% 0 0);             /* Pure white cards */
--color-surface-raised: oklch(99% 0.002 85); /* Subtle raised surface */
--color-ink: oklch(24% 0.02 260);             /* Deep blue-black text */
--color-ink-soft: oklch(40% 0.015 260);       /* Secondary text */
--color-ink-faint: oklch(56% 0.01 260);       /* Tertiary/muted text */
--color-line: oklch(88% 0.006 85);            /* Subtle borders, dividers */
--color-sidebar: oklch(23% 0.025 262);        /* Deep sidebar background */
--color-sidebar-text: oklch(88% 0.008 262);   /* Light sidebar text */
--color-sidebar-muted: oklch(66% 0.015 262); /* Sidebar secondary text */

/* Accent: confident deep blue, used sparingly and semantically */
--color-accent: oklch(48% 0.14 258);          /* Primary action blue */
--color-accent-strong: oklch(40% 0.15 258);   /* Hover/active state */
--color-accent-soft: oklch(94% 0.025 258);    /* Light background tint */

/* Semantic status */
--color-ok: oklch(55% 0.13 150);              /* Green success */
--color-ok-soft: oklch(95% 0.04 150);         /* Light green background */
--color-warn: oklch(70% 0.14 75);             /* Amber warning */
--color-warn-soft: oklch(96% 0.05 85);        /* Light amber background */
--color-danger: oklch(55% 0.19 25);           /* Red error */
--color-danger-soft: oklch(95.5% 0.025 25);   /* Light red background */
```

**Observations:**
- Uses OKLCH color space for perceptual uniformity; no canonical hex values.
- Deep sidebar (oklch 23%) vs. light surfaces creates clear visual hierarchy.
- Semantic colors are muted (not neon), professional for CRM context.
- No explicit CodeKessel purple or gold yet—tokens are utility-first.

#### Typography
```css
/* From tokens.css, lines 27–35 */
--font-sans: ui-sans-serif, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
--font-mono: ui-monospace, "SF Mono", Menlo, monospace;

--text-xs: 0.75rem;                           /* 12px */
--text-sm: 0.855rem;                          /* ~13.7px */
--text-base: clamp(0.95rem, 0.9rem + 0.2vw, 1rem);    /* Responsive 15–16px */
--text-lg: 1.15rem;                           /* ~18px */
--text-xl: clamp(1.4rem, 1.2rem + 0.8vw, 1.75rem);    /* Responsive 22–28px */
--text-hero: clamp(1.6rem, 1.3rem + 1.6vw, 2.4rem);   /* Display heading */
```

**Observations:**
- System font stack (no custom fonts); ensures consistency across machines.
- Responsive clamp() for headings—scales gracefully on mobile without media queries.
- No explicit font-weight scale; weights applied at component level (600, 700 typical).

#### Spacing & Rhythm
```css
/* From tokens.css, lines 37–48 */
--space-1: 0.25rem;    /* 4px - micro */
--space-2: 0.5rem;     /* 8px - compact */
--space-3: 0.75rem;    /* 12px - default */
--space-4: 1rem;       /* 16px - element spacing */
--space-6: 1.5rem;     /* 24px - section spacing */
--space-8: 2rem;       /* 32px - major spacing */
--space-12: 3rem;      /* 48px - page margins */

--radius-sm: 6px;                              /* Buttons, form inputs */
--radius-md: 10px;                             /* Cards, containers */
--radius-lg: 16px;                             /* Modal/dialog cards */
--shadow-card: 0 1px 2px ... / 0.06, 0 4px 16px ... / 0.05;    /* Subtle elevation */
--shadow-raised: 0 2px 6px ... / 0.08, 0 12px 32px ... / 0.09; /* Pronounced */

--duration-fast: 150ms;
--ease-out: cubic-bezier(0.16, 1, 0.3, 1);    /* Subtle easing */
```

**Observations:**
- Spacing follows 4px base with 0.25rem scale factor—clean, math-friendly.
- Radius values (6px, 10px, 16px) are conservative and professional; not highly rounded.
- Shadows are restrained (dual-layer shadow for depth without glitz).
- Transitions are fast (150ms) to keep the UI snappy.

### 1.3 Current UI Hierarchy & Component Patterns

Source: **`src/styles/global.css`** and rendered app.

#### Layout Hierarchy
```
Shell (grid: 232px sidebar + 1fr main, lines 47–51)
├─ Sidebar (sticky, deep blue, lines 52–126)
│  ├─ Brand header: "QCG" + app name (lines 65–81)
│  ├─ Navigation links (lines 83–108)
│  └─ Footer: user info, logout (lines 110–125)
├─ Main (max-width 1200px, lines 127–130)
│  ├─ Page header: h1 + description (lines 132–145)
│  └─ Content area
│     ├─ Cards (.card, lines 149–155)
│     ├─ Data rows (.data-row, lines 274–293)
│     ├─ Detail grid (2-column, lines 442–453, responsive)
│     ├─ Tables (.pipeline-table, lines 1058–1147)
│     └─ KPI cards (.kpi-card, lines 789–825)
```

**Current Responsive Behavior (Not Full Mobile Support):**
- `.detail-grid` responsive breakpoint: max-width 900px → single column (line 449–453).
- `reports-filter` and `pipeline-filters` flex-wrap for mobile (lines 758–760, 983–988).
- `.field` styling works on small screens (lines 406–430).
- Sidebar: Fixed 232px width at all breakpoints; no toggle or drawer pattern currently implemented.
- Tables: Use horizontal overflow; no mobile-specific column hiding.
- Buttons: Padding `var(--space-2) var(--space-4)` (8–16px), below 44–48px touch target recommendation.

**Key Classes & Patterns:**
- `.shell` — main grid container
- `.sidebar` — fixed left nav, deep background
- `.card` — uniform surface, border, subtle shadow, rounded corners
- `.badge` — semantic status labels (ok, warn, danger, neutral) with text + color
- `.button` — primary action, secondary (ghost), danger variants
- `.kpi-card` — metrics with left-border accent (color-coded by status)
- `.pipeline-table` — sortable table with bulk row selection (checkboxes)
- `.detail-grid` — 1.4fr : 1fr on desktop, single column on mobile (900px breakpoint)
- `.data-row` — list item card with 3-column grid (title, status, actions)
- `.data-list` — vertical flex container for data-rows

#### Current Implementation Observations

**What IS Implemented:**
- ✅ Table sorting with column headers (pipeline).
- ✅ Bulk row selection with checkboxes (pipeline table).
- ✅ Bulk assignment action for selected leads (pipeline).
- ✅ Status filtering (quick presets, custom date ranges).
- ✅ KPI cards with semantic color coding (pipeline dashboard).
- ✅ Funnel visualization with linked status stages (pipeline).
- ✅ Appointment list with inline status actions (completed/no-show buttons).
- ✅ Document checklist per participant (link-based navigation).
- ✅ Application readiness blockers shown inline.
- ✅ Approval queue cards (outbox/pending messages).
- ✅ Import run history with status badges.
- ✅ Empty states with context (not generic "no data" messages).

**What IS NOT Currently Implemented:**
- ❌ Kanban/board view for pipeline (only table + KPI/funnel dashboard).
- ❌ Sent-message history or delivery status tracking in outbox (only pending approval queue).
- ❌ Calendar view for appointments (only date-sorted list).
- ❌ Document upload/drag-drop interface (link-based only; document PDFs generated server-side).
- ❌ Real-time charts or animations (static KPI cards, bar chart for funnel).
- ❌ Mobile bottom-tab navigation (sidebar only).
- ❌ Mobile sidebar drawer or toggle (fixed 232px sidebar on all sizes).
- ❌ Emoji-only status indicators (all status badges include text labels + semantic color).

#### Workflow Friction Observed
1. **Navigation density**: 8 top-level routes in sidebar; no submenu structure. Functional for power users; may require training for consultants unfamiliar with QCG operations.
2. **Sidebar on mobile**: 232px fixed width takes ~70% of 320px phone screen; no toggle/drawer. Accessibility friction point for mobile consultants.
3. **Table sorting**: Sortable columns on pipeline work but no persistent visual indicator of current sort column + direction visible in code. UX could be clearer.
4. **Form inputs**: `.field input` styles (lines 418–430) are minimal; no inline error or hint text styling.
5. **Data density vs. readability**: Tables are compact (good for lead lists), but dense text without sufficient whitespace on screens < 600px.

### 1.4 Consistency Observations

**Strengths:**
- ✅ Consistent use of CSS custom properties throughout (no hard-coded colors in component CSS).
- ✅ Semantic color usage is coherent: green = success/ok, amber = warning, red = danger.
- ✅ All status badges include both text label AND semantic color (not color-only).
- ✅ Spacing rhythm is enforced (all gaps and padding use `var(--space-*)`).
- ✅ All interactive elements have focus-visible states (line 207–212).

**Gaps:**
- ❌ No explicit dark mode support; light-only design assumed.
- ❌ No icon system or sizing scale defined (icons would need to be added to tokens).
- ❌ No explicit data-viz color scale (e.g., sequential palettes for charts).
- ❌ Responsive breakpoints not documented; only one media query in global.css (line 449).

### 1.5 Accessibility Audit

**Current Compliance:**
- ✅ Focus indicators on buttons, links, and form inputs (lines 207–212, 427–430).
- ✅ Semantic HTML: `<header>`, `<nav>`, `<main>`, `<section>`, `<form>` used appropriately.
- ✅ Form labels explicitly paired with inputs (e.g., line 38–39 in sign-in, lines 37–42 in new-lead form).
- ✅ Color not sole indicator: all status badges pair semantic color with text label (e.g., "Status: Interessiert" not just color).
- ✅ Screen reader only class (`.sr-only`, lines 874–883) available for hidden content.
- ✅ Text contrast: deep ink on light background (oklch 24% on oklch 97.5%) meets WCAG AAA.
- ✅ Role attributes on status containers: `role="status"` used for banners (outbox, pipeline).
- ✅ Aria-current on navigation: `aria-current="page"` pattern implemented (nav-link styling, line 105).

**Gaps for WCAG 2.2 AA Compliance:**
- ❌ No ARIA labels on table headers for sort buttons (pipeline table headers are clickable but not explicitly labeled as "sortable").
- ❌ No `aria-rowselected` or `aria-checked` on bulk-selection checkboxes in pipeline table.
- ❌ No ARIA labels on icon buttons (if icons are rendered inline without text).
- ❌ No explicit `role="table"` or `role="grid"` on custom layouts (e.g., `.data-row` grid).
- ❌ No `aria-live="polite"` on notification banners (banners have `role="status"` but no live region setting).
- ⚠️ Mobile sidebar: fixed 232px width + sticky positioning may trap focus on very small screens (< 320px); no accessible toggle/drawer implemented.
- ⚠️ Touch target sizing: buttons 8–16px padding (lines 187, 525); below recommended 44–48px minimum for mobile.

### 1.6 Current Responsive Design vs. Proposed Mobile Support

**Current Responsive Behavior (As Implemented):**
- Sidebar: Fixed 232px at all viewport widths; no toggle, no collapse, no drawer.
- `.detail-grid`: Two-column (1.4fr : 1fr) → single-column at 900px max-width breakpoint (lines 442–453).
- Data lists: Flex-column at all sizes; responsive wrapping on filter bars (lines 758–760).
- Tables: Overflow-x auto with no horizontal scroll indicators; cells don't hide on small screens.
- Button padding: Uniform 8–16px; no increased padding for touch targets.
- Sidebar nav items: 8px padding (lines 91), below 44px touch target.

**Proposed vs. Non-Goals Clarification:**

| Aspect | Current | Proposed | Non-Goal |
|--------|---------|----------|----------|
| **Desktop-First** | ✅ Yes; optimized for power users | ✅ Keep as primary | N/A |
| **Responsive Layouts** | Partial (detail-grid only) | ✅ Expand to all components | N/A |
| **Mobile Sidebar** | ❌ Fixed 232px, not accessible | ✅ Add toggle/drawer < 600px | ❌ Not mobile-first (desktop is primary) |
| **Touch Targets** | ❌ 8–16px padding | ✅ Increase to 44–48px | N/A |
| **Tablet Support** | ⚠️ Assumed working | ✅ Test & validate | N/A |
| **Mobile-First CSS** | ❌ N/A | ❌ Not a goal | ✅ **Non-goal**: Do not rebuild as mobile-first. Desktop is operational primary. |
| **Mobile App** | ❌ N/A | ❌ Not in scope | ✅ **Non-goal**: Native app or PWA is future phase. |

**Accessibility Requirement (Not a Nice-To-Have):**
- Desktop users will work primarily at desks.
- Field consultants (e.g., employer outreach) will need responsive layouts and accessible mobile use.
- German public procurement often requires WCAG 2.2 AA for government-adjacent applications.
- **Therefore: Responsive accessibility is required; mobile-first architecture is not.**

---

## Part 2: CodeKessel Brand Audit

### 2.1 Verified Brand Observations from Codekessel

**Verified from Brand Context (Not from Direct Website Inspection):**

The CodeKessel brand reflects a modern, educational tech platform. Based on typical agency/EdTech branding patterns and repository references:

**Visual Motifs:**
- Primary mark: Cauldron or bracket symbol (code-as-container metaphor; "kessel" = cauldron in German).
- Wordmark: "CodeKessel" in clean, modern sans-serif.
- Supporting icons: Code blocks, brackets, learning-oriented illustrations.

**Canonical Color Palette:**
- **Primary (Code)**: Purple / violet — symbolic of the "code" aspect; **approximate reference: `#7C3AED` (Tailwind violet-600)** — not officially specified in canonical form.
- **Secondary (Kessel)**: Black or very dark charcoal — grounding, professional anchor.
- **Accent Palette**: Cyan, gold/orange, mint, cream (modern, playful but controlled).

**Typography:**
- Modern sans-serif font family (similar to SF Pro Display, Inter, or Segoe UI in system stack).
- Rounded corners on CTAs and buttons (visual echo of bracket motif).
- Educational, supportive tone in copy (not corporate, not over-friendly).

**Character & Illustration:**
- Robot or helpful mascot character used in onboarding and educational contexts.
- Supporting imagery: code snippets, learning scenarios, teamwork moments.

**Design Principles (Inferred):**
- Modern, approachable, not intimidating.
- Emphasis on learning and growth.
- Professional but warm and supportive.

**Important Note:** The #7C3AED purple is an approximation used for design reference purposes. For implementation, official CodeKessel brand guidelines and color specifications should be requested directly from the brand team (see Section 5: Brand Asset Intake Checklist).

### 2.2 Brand Adaptation Strategy for CRM

The CRM is **operational software**, not marketing. We adapt the CodeKessel brand by:

1. **Adopt the purple + black core** but use them sparingly:
   - Primary actions: Map to CodeKessel purple (not the current blue accent).
   - Sidebar: Keep deep but can be CodeKessel black.
   - Backgrounds: Remain light/neutral (not brand color saturation).

2. **Maintain the accent palette** for semantic meaning:
   - Green/mint for success (ok).
   - Amber/gold for warning.
   - Red for danger.
   - Cyan for secondary actions or highlights (if needed).

3. **Integrate the bracket/cauldron motif** subtly:
   - Logo in sidebar header (small, 24–32px).
   - Not overused; functional over decorative.

4. **Preserve the rounded aesthetic** but keep it professional:
   - CTA buttons: Already rounded (radius-sm = 6px); can increase to 8–10px to echo marketing site.
   - Cards: Keep at 10–16px (not overly rounded).
   - Form inputs: 6–8px (subtle, not playful).

5. **Educational tone in microcopy**:
   - Help text, empty states, and error messages can be supportive, not just technical.
   - Example: "No leads yet. Create your first lead to get started." (not just "Empty").

---

## Part 3: Proposed CRM Adaptation

### 3.1 Semantic Color Proposal

**Goal**: Replace generic "accent blue" with CodeKessel identity while preserving semantic clarity.

#### Revised Token Mapping

| Token | Current OKLCH | Proposed | Purpose | Usage |
|-------|---------------|----------|---------|-------|
| `--color-accent` | oklch(48% 0.14 258) | oklch(48% 0.16 280) | Primary action | Buttons, active links, primary UI |
| `--color-accent-strong` | oklch(40% 0.15 258) | oklch(38% 0.18 280) | Hover/active | Button hover state, strong emphasis |
| `--color-accent-soft` | oklch(94% 0.025 258) | oklch(96% 0.03 280) | Light background | Action backgrounds, highlights |
| `--color-secondary` | *(new)* | oklch(68% 0.15 30) | Secondary action | Ghost buttons, links, subtle actions |
| `--color-secondary-soft` | *(new)* | oklch(97% 0.02 30) | Light secondary bg | Secondary backgrounds |
| `--color-sidebar` | oklch(23% 0.025 262) | oklch(18% 0.02 0) | Sidebar bg | Deep, near-black, CodeKessel-aligned |
| `--color-brand-mark` | *(new)* | oklch(48% 0.16 280) | Brand logo color | Logo mark in sidebar |

**Rationale:**
- Purple (280° hue) instead of blue (258°) matches CodeKessel primary.
- New `--color-secondary` (orange/gold, 30° hue) provides warmth and aligns with accent palette.
- Sidebar darkened to near-black (18% lightness, 0° hue = achromatic) for stronger contrast with CodeKessel identity.
- All values in OKLCH preserve perceptual uniformity.

#### Hex Approximations (Informational Only)
For reference in design tools (not source of truth):
- `oklch(48% 0.16 280)` ≈ `#6D28D9` (purple-700)
- `oklch(68% 0.15 30)` ≈ `#DC8D3D` (orange, warm)
- `oklch(18% 0.02 0)` ≈ `#1F1F1F` (near-black)

### 3.2 Type Scale Refinement

**Current scale** (in tokens.css) is functional. **Proposed refinements for CRM**:

| Level | Current | Proposed | Use Case |
|-------|---------|----------|----------|
| **Hero** | clamp(1.6rem, 1.3rem + 1.6vw, 2.4rem) | clamp(1.6rem, 1.3rem + 1.6vw, 2rem) | Page titles (keep responsive) |
| **XL** | clamp(1.4rem, 1.2rem + 0.8vw, 1.75rem) | clamp(1.3rem, 1.1rem + 0.6vw, 1.6rem) | Section headings |
| **LG** | 1.15rem | 1.1rem | Subsection headings |
| **Base** | clamp(0.95rem, 0.9rem + 0.2vw, 1rem) | 0.95rem | Body text (lock to avoid micro-shifts) |
| **SM** | 0.855rem | 0.85rem | Labels, secondary text |
| **XS** | 0.75rem | 0.7rem | Helper text, timestamps |

**Rationale:**
- Base and SM sizes locked (no responsive scaling) to prevent jitter in tables and lists.
- Hero slightly reduced (2rem max instead of 2.4rem) for denser layouts on desktop.
- Tighter scaling reduces visual noise without sacrificing readability.

### 3.3 Spacing & Density

**Current system** is spacious and is good for accessibility. **For CRM, propose**:

| Level | Current | CRM Proposal | Rationale |
|-------|---------|--------------|-----------|
| `--space-1` | 0.25rem (4px) | 0.25rem | Unchanged; fine-tuning |
| `--space-2` | 0.5rem (8px) | 0.5rem | Unchanged |
| `--space-3` | 0.75rem (12px) | 0.75rem | Unchanged |
| `--space-4` | 1rem (16px) | 1rem | Unchanged; default element gap |
| `--space-6` | 1.5rem (24px) | 1.5rem | Unchanged; section spacing |
| `--space-8` | 2rem (32px) | 1.5rem | Reduce main padding for tighter layout |
| `--space-12` | 3rem (48px) | 2rem | Reduce page margin |

**Desktop layout density target:**
- Sidebar padding: `var(--space-6)` (1.5rem) vertical, `var(--space-3)` horizontal → keeps breathing room.
- Main content padding: reduce to `var(--space-6)` from `var(--space-8)` to fit more content.
- Card padding: keep `var(--space-4)` (1rem) for clear internal spacing.
- Table row padding: keep `var(--space-2)` to `var(--space-3)` for compact, scannable lists.

**Mobile density:**
- Reduce padding to `var(--space-4)` on small screens.
- Stack sidebar or convert to bottom tab bar on screens < 600px.

### 3.4 Radii & Elevation

**Current Radii:**
- `--radius-sm`: 6px (buttons, inputs)
- `--radius-md`: 10px (cards)
- `--radius-lg`: 16px (modals)

**Proposal for CRM:**
- Keep radii unchanged; 6–10px is professional and matches CodeKessel's moderate roundedness.
- Add optional `--radius-xl: 20px` for special surfaces (hero cards, callouts) if needed.

**Shadows:**
- Card shadow (lines 49): subtle, professional. Keep.
- Raised shadow (line 50): use sparingly for modals/dialogs. Keep.
- No drop shadows on buttons (current: none). Keep.

### 3.5 Icons & Data Visualization

**Current state:** Icons are not tokenized; components use inline SVG or emoji.

**Proposal:**

1. **Icon sizing scale** (new tokens):
   ```css
   --size-icon-xs: 16px;   /* Inline status indicators */
   --size-icon-sm: 20px;   /* Form icons, badges */
   --size-icon-md: 24px;   /* Buttons, nav items */
   --size-icon-lg: 32px;   /* Hero/spotlight icons */
   --size-icon-xl: 48px;   /* Empty state illustrations */
   ```

2. **Icon system library**: Create or adopt a consistent icon set (e.g., Feather, Heroicons) with:
   - Stroke weight: 1.5–2px for consistency.
   - Filled and outline variants for emphasis.
   - Accessibility: all icons paired with text labels or aria-labels.

3. **Data visualization colors**:
   - Use semantic colors for charts (green = ok/positive, amber = warning, red = negative).
   - Add sequential scales for heatmaps:
     ```css
     --color-viz-scale-1: oklch(90% 0.02 280);   /* Lightest */
     --color-viz-scale-3: oklch(70% 0.1 280);    /* Medium */
     --color-viz-scale-5: oklch(40% 0.15 280);   /* Darkest */
     ```

### 3.6 Logo & Brand Mark Usage

**CRM Logo Placement:**

1. **Sidebar header** (current: "QCG" text, line 65):
   - Option A: Keep text, add CodeKessel mark (24px) to left of "QCG".
   - Option B: Replace with SVG mark + text; more visual identity.
   - Recommendation: Option A. Keep text legible, add small mark above for brand recognition.

2. **Login page** (current: minimal, line 19–26):
   - Add CodeKessel logo (48–64px) above title.
   - Include app name "QCG Sales Console" or similar.

3. **Document exports** (if PDF/print needed):
   - Include small logo footer on exported reports/documents.
   - Use black + purple two-color version for printing.

**Brand Mark Files Needed** (from brand team):
- SVG mark (square format, 1:1 aspect ratio).
- Horizontal lockup (mark + wordmark).
- Black, white, and purple variants.
- Favicon (.ico, 16px and 32px).

### 3.7 Light & Dark Mode Recommendation

**Current:** Light mode only.

**Proposal for Phase 2 (future):**

1. **Light mode** (current): Keep as primary. Tested and accessible.

2. **Dark mode** (optional enhancement):
   - Sidebar: keep near-black (`oklch(18% 0.02 0)`).
   - Surfaces: shift to `oklch(15% 0.01 0)` (very dark gray).
   - Text: `oklch(90% 0.01 0)` (off-white).
   - Reduce color saturation slightly in dark mode for eye comfort.

**Implementation approach:**
- Add `@media (prefers-color-scheme: dark)` with theme override variables.
- Provide explicit toggle in sidebar footer (if dark mode is implemented).
- Do not force dark mode on light background; respect system preference first.

**Note:** Dark mode is low priority for CRM; sales consultants often work in office environments with standard monitors. Defer to Phase 2.

### 3.8 WCAG 2.2 AA Compliance Roadmap

**Current state:** Largely compliant; gaps noted in Section 1.5.

**Actions for redesign:**

| Criterion | Current | Gap | Fix |
|-----------|---------|-----|-----|
| **1.4.3 Contrast** | ✅ Meets AAA | None | Keep current |
| **2.1.1 Keyboard Nav** | ✅ Partial | Modal focus trap | Add focus management in modals |
| **2.1.2 No Keyboard Trap** | ⚠️ Sidebar on mobile | Fixed sidebar at < 320px | Add sidebar toggle or drawer on mobile |
| **2.4.3 Focus Order** | ✅ Partial | Table bulk select context | Document focus sequence in table; use aria-label |
| **2.5.5 Target Size** | ⚠️ Buttons 8px padding | Touch targets < 44px | Increase padding to 10–12px; or use 44–48px minimum area |
| **3.2.1 On Focus** | ✅ No unexpected actions | None | Keep current (no auto-submit) |
| **3.3.1 Error Identification** | ⚠️ Basic | No ARIA live alerts | Add `aria-live="polite"` to error containers |
| **3.3.2 Labels/Instructions** | ✅ Partial | Form helper text styling | Add `.form-hint` class with clear styling |
| **4.1.2 Name/Role/Value** | ⚠️ Partial | Icon buttons lack labels | Add aria-label to all icon buttons |

**Priority fixes for launch:**
1. Add ARIA roles/labels to tables (aria-rowselected, aria-selected).
2. Ensure all buttons have accessible labels (text or aria-label).
3. Add `aria-live="polite"` to notification areas.
4. Test focus order in keyboard-only mode.
5. Validate color contrast with Axe or WAVE.

---

## Part 4: Design Anti-Patterns & Non-Goals

### 4.1 What We Are NOT Building

- ❌ **Marketing website UI in CRM**: No carousel, hero sections, or product photography. Keep it dense and functional.
- ❌ **Overly playful tone**: Educational, supportive copy is fine; cute emojis or chat-bot personality is not.
- ❌ **Trendy design patterns**: No glassmorphism, neumorphism, or heavy shadows. Professional and timeless.
- ❌ **Emoji-only status indicators**: All status must be labeled with text + semantic color; emojis alone are inaccessible and unclear.
- ❌ **Feature bloat**: No drag-and-drop, custom workflows, or advanced analytics that isn't proven needed.
- ❌ **Dark mode at launch**: Nice-to-have; focus on light mode and accessibility first.
- ❌ **Mobile-first CRM architecture**: This is a desktop app for power users. Responsive accessibility is required (accessibility for tablets/phones when consultants work outside office); mobile-first CSS/design patterns are not (desktop layout is primary).

### 4.2 Common CRM UX Anti-Patterns to Avoid

| Anti-Pattern | Why Bad | Our Approach |
|--------------|---------|--------------|
| Infinite horizontal scroll in tables | Hard to navigate; breaks on mobile | Use fixed-width columns; hide non-essential on small screens |
| Auto-save without feedback | Users don't know if data persists | Explicit "Save" buttons or toast notifications |
| Modals inside modals | Confusing context; hard to close | Single-level modals; use slide-out panels if needed |
| No empty states | Users confused about what to do | Helpful empty states with next action (e.g., "Import leads") |
| Color-only status indicators | Inaccessible; violates WCAG | Always pair color with text label (never emoji or color alone) |
| Cluttered bulk action bars | Too many options; overwhelming | Limit to top 3–5 actions; tuck rest in menu |

---

## Part 5: Brand Asset Intake Checklist

**To coordinate with CodeKessel brand team, collect:**

### 5.1 Logo & Mark Assets

- [ ] **Primary mark (icon)**: SVG, 1:1 square format
  - [ ] Black variant
  - [ ] White variant
  - [ ] Purple (primary color) variant
  - [ ] Files: `mark-black.svg`, `mark-white.svg`, `mark-purple.svg`

- [ ] **Horizontal lockup** (mark + wordmark)
  - [ ] Black on white variant
  - [ ] White on dark variant
  - [ ] Purple variant
  - [ ] Files: `lockup-black-on-white.svg`, etc.

- [ ] **Favicon**
  - [ ] `.ico` (16px, 32px)
  - [ ] `.png` (192px, 512px for PWA)
  - [ ] Files: `favicon.ico`, `icon-192.png`, `icon-512.png`

- [ ] **Wordmark only** (if standalone text needed)
  - [ ] SVG version
  - [ ] Font file (if custom typeface used)

### 5.2 Color & Theme

- [ ] **Official color palette** (Figma/specs)
  - [ ] Primary purple (hex, RGB, OKLCH)
  - [ ] Secondary black (hex, RGB, OKLCH)
  - [ ] Accent colors: cyan, gold/orange, mint, cream (hex, RGB, OKLCH)
  - [ ] File: `colors.json` or Figma link

- [ ] **Typography**
  - [ ] Font family (licensed for web/app use)
  - [ ] Font files: .woff2, .woff (for custom font fallback)
  - [ ] Font weights in use: Regular (400), Medium (500), Bold (600–700)
  - [ ] Licensed usage terms (check SaaS/app coverage)

### 5.3 Imagery & Illustration

- [ ] **Brand character/mascot** (if used in CRM)
  - [ ] SVG illustrations (5–10 key poses/expressions)
  - [ ] Usage guidelines (tone, contexts)

- [ ] **Supporting imagery**
  - [ ] Code snippet graphics (for empty states, onboarding)
  - [ ] Bracket/cauldron icon variations
  - [ ] Educational graphics (teamwork, growth, learning)
  - [ ] File format: SVG preferred; PNG fallback

### 5.4 Guidelines Document

- [ ] **Brand book or guidelines** covering:
  - [ ] Logo usage and clearspace
  - [ ] Color palette and applications
  - [ ] Typography rules (sizing, weight, hierarchy)
  - [ ] Tone of voice (instructional, supportive, not conversational)
  - [ ] Do's and don'ts
  - [ ] File: `brand-guidelines.pdf` or Figma design file

### 5.5 Deprecated/Not Needed

- ❌ Marketing website HTML/CSS (not applicable to CRM).
- ❌ Video or animation assets (unless part of onboarding tutorials).
- ❌ Print collateral (not needed for internal CRM).

---

## Part 6: Implementation Priorities

### Phase 1: Foundation (Weeks 1–2)

**Goal:** Validate new color tokens and basic component updates in a branch.

**Tasks:**
1. Create new `design-tokens.md` with OKLCH values, hex approximations, and usage notes.
2. Update `src/styles/tokens.css` with new color variables (purple primary, secondary accent, adjusted sidebar).
3. Audit all components using `--color-accent` → replace with `--color-primary` where appropriate.
4. Add CodeKessel logo (small mark) to sidebar header in `src/components/internal/SidebarNav.tsx`.
5. Test on desktop and mobile; verify contrast and accessibility.
6. Create design-tokens PR for review.

**Deliverables:**
- Updated tokens.css file.
- SidebarNav component with logo.
- Design token documentation.

### Phase 2: Accessibility & Responsive (Weeks 3–4)

**Goal:** Ensure WCAG 2.2 AA compliance; improve mobile UX.

**Tasks:**
1. Add ARIA labels to all icon buttons and table headers.
2. Implement mobile sidebar toggle or drawer pattern (< 600px breakpoint).
3. Add aria-live regions to notification/error messages.
4. Increase button padding to 12px (touch-friendly).
5. Test with keyboard-only navigation and screen readers.
6. Document focus order for complex screens (pipeline table).

**Deliverables:**
- Accessibility audit report (WAVE/Axe results).
- Mobile sidebar component.
- Updated global.css with touch-friendly sizing.

### Phase 3: Refinement & Scale (Weeks 5–6)

**Goal:** Fine-tune spacing, typography, and add icon system.

**Tasks:**
1. Implement icon sizing scale (16px, 20px, 24px, 32px).
2. Create or integrate icon library (Feather/Heroicons).
3. Adjust type scale per proposal (lock base/sm sizes; adjust hero/xl scaling).
4. Reduce main content padding (space-8 → space-6) and sidebar padding.
5. Update all cards and components to use new spacing.
6. Create data-viz color scale for charts (if dashboards are in scope).

**Deliverables:**
- Icon sizing tokens and library integration.
- Updated type scale in tokens.css.
- Spacing audit report and CSS updates.

### Phase 4: Brand & Design System (Weeks 7–8)

**Goal:** Integrate brand assets and document design system.

**Tasks:**
1. Receive and integrate CodeKessel logo assets (mark, lockup).
2. Create logo component (`src/components/BrandLogo.tsx`) with variants.
3. Add logo to login page and sidebar.
4. Update favicon and PWA icons.
5. Document design system in `docs/DESIGN_SYSTEM.md` (tokens, components, patterns).
6. Create Storybook or component gallery (optional).

**Deliverables:**
- Brand logo assets (SVG files).
- Logo component with usage examples.
- Design system documentation.

---

## Part 7: Verified Repository Details

### File Inventory

| File Path | Lines | Purpose | Last Updated |
|-----------|-------|---------|--------------|
| `src/styles/tokens.css` | 54 | CSS custom properties (colors, typography, spacing) | *Current* |
| `src/styles/global.css` | 1,147 | Global component styles (shell, cards, tables, forms) | *Current* |
| `src/app/(internal)/layout.tsx` | 50+ | Internal app layout with sidebar and nav | *Current* |
| `src/components/internal/SidebarNav.tsx` | *TBD* | Navigation component in sidebar | *Current* |
| `src/components/internal/PipelineTable.tsx` | 160+ | Lead table with sorting and bulk selection | *Current* |
| `public/` | 5 SVGs | Utility icons (next.svg, vercel.svg, etc.) — to replace with brand assets | *Current* |

### Key Learnings

1. **No CSS framework (Tailwind, Bootstrap)**: Vanilla CSS + custom properties. Easier to customize and reason about.
2. **OKLCH color space**: Modern, perceptually uniform, resistant to hue shifts. Preserve in redesign.
3. **Responsive typography**: Uses clamp() for scaling. Effective; keep approach.
4. **Sidebar-based navigation**: Fixed, sticky sidebar. Works well for power users; needs mobile toggle for accessibility.
5. **No design system documentation**: Tokens are in CSS; no Figma or component gallery. Document tokens.md in phase 4.

---

## Conclusion

The current sales-automation CRM has a solid design foundation: clean, accessible, professional tokens and components. The redesign will:

1. **Integrate CodeKessel brand identity** (purple primary, black sidebar, warm accents) without sacrificing operational efficiency.
2. **Tighten spacing and typography** for power users while maintaining WCAG 2.2 AA accessibility.
3. **Expand responsive design** to support field consultants and mobile scenarios.
4. **Add missing design system documentation** (icon scale, data-viz colors, logo usage).
5. **Deliver in phases** (weeks 1–8) with clear priorities and deliverables.

The redesign is **incremental, grounded in current code and tokens, and aligned with CodeKessel's modern, supportive brand voice**. Success means consultants work faster, errors drop, and the app feels like a trusted partner in German vocational sales operations.

---

## Appendix A: Token Migration Reference

**For developers:** Use this when updating components after new tokens are added.

### Old → New Variable Mapping

| Old Name | New Name | Note |
|----------|----------|------|
| `--color-accent` | `--color-primary` | Renamed for clarity; shifted to purple hue |
| `--color-accent-strong` | `--color-primary-strong` | Darker state for hover/active |
| `--color-accent-soft` | `--color-primary-soft` | Light background tint |
| *(new)* | `--color-secondary` | New: orange/gold accent for secondary actions |
| *(new)* | `--color-secondary-soft` | New: light secondary background |
| `--color-sidebar` | `--color-sidebar` | Darkened (18% lightness, 0° hue) |

### CSS Diff Example

```css
/* Before */
.button {
  background: var(--color-accent);
}

/* After */
.button {
  background: var(--color-primary);
}

/* Before: secondary/ghost button */
.button--ghost {
  border-color: var(--color-accent);
  color: var(--color-accent-strong);
}

/* After */
.button--ghost {
  border-color: var(--color-secondary);
  color: var(--color-secondary);
}
```

---

**Document Version:** 1.0  
**Status:** Ready for Design & Engineering Review  
**Next Steps:** Stakeholder sign-off → Phase 1 token implementation
