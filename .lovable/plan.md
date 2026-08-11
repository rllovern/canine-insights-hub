# Budget Pacing: trim the extra text

## Changes in `src/pages/BudgetPacing.tsx`

- Remove both footnote paragraphs under the table (the pacing explanation and the projection/campaign-label note).
- Remove the "On pace" / "Slightly behind pace" caption line under the % Spend badge.
- % Spend goes back to a single right-aligned badge on one line, matching every other column. The color grading and the hover tooltip with the full math ("34.0% spent, 35.5% expected by day 11 of 31...") stay exactly as they are.

No changes to `src/lib/budgetPacing.ts` — thresholds and verdict logic are untouched.