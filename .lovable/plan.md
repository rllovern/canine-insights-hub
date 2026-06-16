## Scope

Restyle the left navigation only — sidebar background, group labels, item rows, active state, account card, and the Data Sources panel — to match the reference screenshot. No structural changes to the nav hierarchy you previously approved (Command, Monitor group, Deliver group, Jarvis, Admin collapse) and no changes to any other page yet.

## Visual target (from reference)

- Surface: near-white sidebar (`#FAFAFA`-ish) with a hairline right border, no dark navy.
- Brand block: blue rounded-square "R" mark + "Ridgeside K9" in bold, "Acquisition Intelligence" as a smaller muted subtitle. Thin divider below.
- Group labels: small uppercase, letter-spaced, light gray (e.g. "REPORTING", "DATA SOURCES"). Same treatment for existing "Monitor" / "Deliver".
- Nav rows: 14px, medium weight, dark slate text, subtle icon. Inactive = no background. Hover = very light gray. Active = bold text + a 2px black left bar + slightly darker text (no filled pill, no gold accent on the light theme).
- Badges on rows: red circular count badge (e.g. Command "2"), neutral gray "SOON" pill — render only when data calls for them (kept generic, no hardcoded counts).
- Data Sources panel: same row rhythm, colored dot on the left, label in dark slate, status text right-aligned in green ("Live") or red ("Blocked") — uppercase, small, medium weight.
- Account card at the bottom: white card, hairline border, slightly smaller; initials chip uses the brand blue.

## Token + typography changes (`src/index.css`)

Light-mode sidebar tokens repointed to the reference palette; dark mode left untouched for now:

```
--sidebar-background: 0 0% 99%;
--sidebar-foreground: 222 25% 18%;
--sidebar-primary:    222 75% 52%;   /* brand blue used by R mark + active accents that need color */
--sidebar-primary-foreground: 0 0% 100%;
--sidebar-accent:     222 15% 95%;   /* hover bg */
--sidebar-accent-foreground: 222 30% 12%;
--sidebar-border:     220 14% 90%;
--sidebar-ring:       222 75% 52%;
```

Body font stays Inter (already set). No new font import required for parity with the reference.

## Component changes

`src/components/layout/Sidebar.tsx`
- Replace gold/navy active treatment with: active row = `text-sidebar-accent-foreground font-semibold` + 2px black left bar (`before:bg-foreground`). Inactive = `text-sidebar-foreground/75`, hover = `bg-sidebar-accent`.
- Drop the gold-tinted Jarvis accent variant in favor of the same row style with a subtle brand-blue icon, to fit the light theme. (Still a single distinct row, just not gold.)
- Group label component restyled: `text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70`.
- Brand block: replace the gold underline bar with the reference layout — small rounded-square brand-blue tile with "R", title "Ridgeside K9" in `font-semibold text-foreground`, "Acquisition Intelligence" subtitle in `text-xs text-muted-foreground`.
- Account card: lighter border, white background, brand-blue initials chip, smaller secondary text.

`src/components/layout/SourceHealthPanel.tsx`
- Section label restyled to match new GroupLabel.
- Row: dot (existing colors), label `text-sidebar-foreground/85`, status text right-aligned in `text-success` / `text-destructive` / `text-muted-foreground`, uppercase 10px, medium weight. Keep existing status logic untouched.

## Out of scope

- Nav structure / grouping (kept exactly as approved).
- Top bar, page content, charts, KPI cards, and any other surface — addressed in follow-up turns.
- Dark-mode sidebar tokens — unchanged this turn.
- Data Sources logic (`rowStatus`, `aggregate`, RPC) — unchanged.

## Files touched

- `src/index.css` — sidebar tokens.
- `src/components/layout/Sidebar.tsx` — styling only.
- `src/components/layout/SourceHealthPanel.tsx` — styling only.
