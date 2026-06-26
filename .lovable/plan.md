# Swap AI-Projected → Verified Sale in Command Funnel + Verdict

## Scope
Two components on `/command` (owner view and Bob's view, every location):
- `src/components/command/JourneyFunnel.tsx`
- `src/components/command/PortfolioVerdict.tsx`

All other surfaces (Performance Report, Assistant, SQL views, `leadModel.ts` canonical math) stay on the existing Good + AI-Projected definition — they're already wired around the canonical model and the user did not ask to change them.

## Changes

### 1. JourneyFunnel
- Qualified Leads node value: `good + verified_sale` (today: `good + projected`).
- Header breadcrumb: `Ad Spend → Records → Qualified (good + verified sale)`.
- Sub-label under Qualified node: `<quality>% quality` where quality = (good + verified) ÷ total.
- Tooltip + Lead Mix footer: show `bad · good · verified sale` instead of `bad · good · AI-projected`.
- CPGL math (Blended/Ad CPGL) keeps using `good_leads` only — unchanged, since CPGL is a media-cost metric tied to good leads.

### 2. PortfolioVerdict
- Numerator for the ring-gauge quality rate: `good + verified` instead of `good + projected`.
- Verdict copy: "Mix: X bad · Y good · Z verified sale."
- Target line + portfolio average label unchanged (still 55%).

### 3. Denominator decision (Total Leads)
- Keep `Total Leads = bad + good + projected` (the canonical three exclusive tiers) so the "21 total" in Lead Mix and the funnel's Records-to-Qualified ratio stay coherent with the rest of the app.
- Only the **numerator** swaps from projected → verified. This matches the user's phrasing ("utilize verified sales in place of AI-projected sales" for the Qualified count) without forcing a schema-wide redefinition.

## Technical notes
- Both components already receive a `totals` object that includes `revenue` (= summed `verified_sale`). No new query or hook is needed.
- No edits to `src/lib/leadModel.ts`, SQL views, or RPCs.
- No data-layer changes; this is presentation-only on Command.

## Out of scope
- Performance Report, Sales Performance, Assistant, sync logic, lead-quality SQL rollup.
- Per-location overrides — applies uniformly to every property as confirmed.
