## Goal
In the Portfolio Verdict card (agency/portfolio mode), make each listed location name clickable so it navigates the user to the **Command page scoped to that specific location**.

## Current state
- The Portfolio Verdict list in `PortfolioVerdict.tsx` already renders each location as a `<Link to={\`/property/${r.property_id}\`}>`.
- That link targets `/property/:slug`, which is blocked for viewers and shows a property detail page — not the Command overview the user wants.

## Plan
1. **Update `PortfolioVerdict.tsx`**
   - Import `useNavigate` from `react-router-dom`.
   - Import `useScope` to access `setScope`.
   - Replace the `<Link>` wrapper around each location row with a `<button>` (or div with `onClick`) that:
     a. Calls `setScope({ mode: "property", propertyId: r.property_id })` to scope the app to that location.
     b. Calls `navigate("/command")` to route to the Command view.
   - Keep all existing row styling (dot, name, reason, chevron) and hover state.

2. **Verify the scope change triggers the right view**
   - `Command.tsx` already consumes `useScope()` and renders a single-property "Location Verdict" when `mode === "property"`.
   - For viewers (Bob), `Command.tsx` still renders the merged Performance Report, but now scoped to the clicked property — which is the correct behavior.

## Out of scope
- No backend or routing changes needed; `/command` is already the canonical Command view.
- No changes to the single-property Location Verdict view (the non-agency branch of `PortfolioVerdict.tsx`).