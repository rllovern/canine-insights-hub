# Visual Rebrand to Match Ridgeside K9 Reference

Goal: restyle the entire dashboard so it visually matches the uploaded reference (dark navy sidebar with gold accents, light cream/white main content, navy + red + gold KPIs and charts). No new charts, no functional changes — every existing page, filter, and metric stays as-is.

## 1. Design tokens (`src/index.css` + `tailwind.config.ts`)

Rework the light-mode palette around the logo colors:

- `--background`: very light warm cream (≈ `40 30% 98%`)
- `--card`: pure white
- `--foreground`: deep navy (≈ `222 45% 14%`)
- `--primary`: Ridgeside navy (`222 60% 20%`)
- `--accent`: Ridgeside red (`354 70% 45%`)
- New `--gold` token (`42 75% 55%`) for highlights, underline accents, and the "Performance Goal" card
- `--muted` / `--border`: warm grays tinted toward cream
- `--success` (greens for positive deltas) and `--destructive` (matched to accent red) preserved

Sidebar tokens (used only inside the navy sidebar):
- `--sidebar-background`: deep navy (`222 55% 14%`)
- `--sidebar-foreground`: cream (`40 30% 92%`)
- `--sidebar-accent`: slightly lighter navy for hover (`222 45% 22%`)
- `--sidebar-primary`: gold for active item left-border / icon tint
- `--sidebar-border`: navy +5% lightness

Dark mode: leave untouched aside from inheriting the new sidebar tokens (per your answer).

Chart palette — brand-led with extensions, so 6–8 sources stay distinguishable:
- `--chart-1`: navy
- `--chart-2`: red
- `--chart-3`: gold
- `--chart-4`: cream/tan
- `--chart-5`: slate gray
- `--chart-6`: muted teal (extension)
- `--chart-7`: plum (extension)
- `--chart-8`: warm taupe (extension)

`SOURCE_COLORS` in `src/lib/metrics.ts` re-mapped so the most prominent sources (Google Ads, Facebook) get navy + red.

## 2. Sidebar (`src/components/layout/Sidebar.tsx`)

Convert the existing sidebar into a persistent dark navy rail used on every authenticated route:

- Top: Ridgeside K9 logo (existing `BrandMark`) on navy, with a thin gold underline below "RIDGESIDE K9 / ASHTABULA" text
- Nav items in cream text; active item gets a gold left border + slightly lighter navy background and gold icon
- Hover: lighter navy fill
- Bottom additions (no new functionality, just visual layout):
  - "Performance Goal" card slot — purely decorative card styled to match reference (gold star, percent, progress bar, "Updated …" label). Pulls a value already exposed in dashboard context if available; otherwise renders a static branded placeholder until we wire a real goal in a later pass.
  - User card row at the very bottom: avatar (initials), `user.email` shortened, role label, sign-out via existing dropdown/menu
- Width unchanged (`w-60`); responsive behavior unchanged

## 3. Top bar (`src/components/layout/TopBar.tsx`)

Keep all controls (property switcher, date range, compare, view-as toggle). Restyle only:

- White background, no blur
- Page title gains a short gold underline accent (matches reference "Overview" treatment)
- Buttons/selects re-themed via the new tokens (no per-component color overrides)
- Export Report button styled as solid navy with white text on the right edge (uses existing export action if present; otherwise stays hidden — no new functionality added)

## 4. KPI cards (`src/components/dashboard/KpiCard.tsx`, `src/components/data/KPICard.tsx`)

Match reference style without adding icons:

- White card, subtle border, soft shadow, rounded-xl
- Label: small uppercase, muted
- Value: large bold tabular-nums, navy foreground
- Delta chip below value: green ▲ / red ▼ pill matching reference, with "vs <prev range>" muted text inline
- Layout adjusted from "label / value+delta inline" to "label / value / delta+hint row" to mirror reference

Both KPI components updated together so all pages benefit.

## 5. Chart cards (`ChartCard`, `MultiLineChart`, `SingleLineChart`, `DualAxisChart`)

- Card: white, rounded-xl, soft shadow, title row with optional right-side control (already supported)
- Lines: monotone curves, navy/red/gold from the new chart palette, `strokeWidth` 2.4, gold accent for secondary series
- Light gridlines on cream background
- Tooltips: white card, navy text, soft shadow (already styled — just adopt new tokens)
- Legend dots styled as filled circles, matching reference

No structural changes to which charts render where.

## 6. Section dividers + tables

- `SectionDivider`: cream background with navy text and a thin gold underline
- Tables (Reports, Campaigns, Call Tracking lists): header row in cream, hover rows in `muted`, numeric columns tabular, positive/negative values tinted via `--success`/`--destructive`

## 7. Out of scope (explicit)

- No new charts, KPIs, or pages
- No backend / data / metric logic changes
- No icon additions to KPI cards
- Dark mode: not redesigned beyond inheriting the new sidebar tokens
- "Performance Goal" sidebar card is a visual slot only — wiring it to a real goal value is a future task

## Files that will change

- `src/index.css`
- `tailwind.config.ts`
- `src/lib/metrics.ts` (SOURCE_COLORS only)
- `src/components/layout/Sidebar.tsx`
- `src/components/layout/TopBar.tsx`
- `src/components/layout/AppShell.tsx` (minor — background color)
- `src/components/dashboard/KpiCard.tsx`
- `src/components/data/KPICard.tsx`
- `src/components/dashboard/ChartCard.tsx`
- `src/components/dashboard/SectionDivider.tsx`
- `src/components/dashboard/MultiLineChart.tsx`
- `src/components/dashboard/DualAxisChart.tsx`
- `src/components/brand/BrandMark.tsx` (color variant for navy sidebar)

After implementation I'll screenshot `/dashboard` and `/calls` and compare against the reference to verify the palette, sidebar, and KPI styling match before handing back.
