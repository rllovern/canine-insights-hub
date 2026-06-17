# Match Executive Overview design 1:1 with the mockup

The current `/command` page uses the right data but keeps the existing app shell, dark cards, and dense typography. Rebuild it as a self-contained page that visually matches the PerformX mockup pixel-for-pixel.

## Visual spec to match

- Page background: light gray (`~#f7f8fa`), no app card chrome.
- Cards: pure white, large border-radius (`rounded-2xl`), soft shadow, generous padding.
- Typography: dark slate headings, light gray subtitles, larger title sizes than today.
- Top bar inside the page:
  - Left: "Executive Overview" (large, bold) + subtitle "Real-time performance across the customer journey".
  - Right: date-range pill button (calendar icon + "May 12 – May 18, 2025" + chevron), "Share" button (outline + upload icon), three-dot menu. Below, small "Compare to: …" caption.
- KPI strip: 5 evenly spaced cards. Each card:
  - Tiny gray label.
  - Big bold value (~28px).
  - Inline green/red pill with up/down arrow and % delta.
  - Subline "vs May 5 – May 11, 2025".
  - Soft blue area sparkline filling the bottom third.
- Customer Journey Funnel: white card, ~2/3 width. Stage row of 5 large pale-gray circles with brand-colored icons, connected by thin gray arrows. Under each: label, value, conversion %. Below funnel, a thin divider, then a 4-column sub-KPI row (Overall Conversion Rate, Cost Per Qualified Call, Cost Per Appointment, Cost Per Revenue $) with bold values + green/red delta pills.
- Revenue Capture Score: white card, ~1/3 width, equal height to funnel. Large green progress ring with score in center + "/100". To the right: short message, then "Estimated Revenue Lost This Week" in red, delta caption below, "View Revenue Impact →" button at bottom (full width, outline).
- Bottom row, 3 equal cards:
  - **Call Handling Performance** — three horizontal progress rails (Answer Rate blue, Avg Answer Time green, Abandon Rate red), each with metric value on the left and goal/delta on the right.
  - **Missed Call Follow-Up Performance** — Missed Calls big number + % caption, then three rails (Returned <5m, Returned <30m, Never Returned) with values, deltas, goals.
  - **Call Quality (AI Score)** — multi-color donut (red/yellow/green/blue segments) with "3.6 / 5.0 Average Score" center, color-coded legend rows on the right with % values, delta caption underneath.
- Top Opportunities to Improve: white card, full width, table with columns Opportunity / Impact (red bold $) / Why It Matters / Action (outline "View Details" button). 4 rows.
- "View Details" link in the top-right of each card uses the brand blue.

## Layout / shell

- Mount this page outside the existing dashboard `Card` styling. Wrap the page in a `bg-[hsl(220_20%_97%)]` (or token equivalent) `min-h-full` container with `p-6 lg:p-8`.
- Keep using the app sidebar/topbar — the mockup's left nav already exists via `Sidebar.tsx`. Only the page body is redesigned.
- Spacing: `gap-5` between major rows, `p-6` inside white cards, no inner card borders.

## Component changes (no new data wiring)

Rewrite the existing files; do not change data sources or the `useCommandData` hook.

- `src/pages/Command.tsx` — new layout shell with header, date pill, share, KPI row, 2-col grid, 3-col grid, opportunities table.
- `src/components/command/KpiSparkCard.tsx` — restyle to white card, large value, pill delta, blue area sparkline anchored to bottom.
- `src/components/command/JourneyFunnel.tsx` — bigger stage circles (size-16), thin arrows between, divider, 4-column sub-KPI row with delta pills.
- `src/components/command/RevenueCaptureScore.tsx` — larger ring (size-40), green stroke when >=75, right-side panel with red lost-revenue number and full-width outline CTA.
- `src/components/command/PerformanceCards.tsx`:
  - `CallHandlingCard` — render 3 progress rails using local (still-mocked) shape until CTM disposition lands; keep the "data not connected" note as a tooltip rather than the entire card body. Pass any partial values we do have (call count) so the layout matches the mockup even when underlying numbers are placeholders flagged with a small "—" hint.
  - `MissedCallFollowUpCard` — match the mockup's row layout (label · % · goal · delta).
  - `CallQualityCard` — match donut + legend layout; render the empty state inside the same skeleton (donut hidden, legend rows shown grayed out) so the card size matches the others.
- `src/components/command/TopOpportunities.tsx` — table styling: row hover, bold red impact, outline button on the right.

## Tokens / styling

- Use Tailwind utility classes scoped to this page. Keep semantic tokens (`bg-card`, `text-foreground`) but override per element with light-mode-only values (`bg-white`, `text-slate-900`, etc.) to match the mockup. Document at the top of `Command.tsx` that this page intentionally locks to the light palette; dark-mode parity is a follow-up.

## Out of scope

- No new data sources, RPC changes, or migrations.
- Sidebar styling stays as is.
- Real CTM Answer Rate / Abandon Rate / Avg Answer Time wiring (still placeholders behind the new layout, surfaced with a small subscript note).

## Verification

- Typecheck/build runs automatically after edits.
- Visual diff: open `/command` in preview at 1504-wide; cross-check KPI strip, funnel + score row, three performance cards, opportunities table against the mockup.
