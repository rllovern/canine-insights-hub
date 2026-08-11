# Fix Active Budget on Budget Pacing

## What's wrong

Central IL shows an active budget of $36.57/day. The page sums every ENABLED Google campaign for the property:

- `Website traffic-Search-1` — $18.00/day (the real PPC budget)
- `LocalServicesCampaign:SystemGenerated:0006288c970aa0a3` — $18.57/day (auto-generated Local Services campaign)

Local Services campaigns are a separate product with their own auto-created budget, so they should not roll into the PPC active budget. Excluding it makes Central IL read $18/day as expected.

## The change

1. Add a shared helper that identifies Local Services / system-generated campaigns by name (`LocalServicesCampaign:...`, anything containing `SystemGenerated`, and names beginning with `Local Services`).
2. Active Budget column: skip those campaigns when summing enabled daily budgets.
3. Spend, % Spend, yesterday, 5-day average, projection and run-rate: apply the same exclusion to the daily metrics rows so pacing math is consistent with the budget shown.
4. Show a small note on the Active Budget cell tooltip listing which campaigns were counted, so an unexpected figure is traceable.
5. If every enabled campaign for a property is excluded, the Active Budget cell shows an em dash rather than $0.

## Technical notes

- `src/lib/budgetPacing.ts`: add `isExcludedCampaign(name: string)` plus the exclusion pattern.
- `src/pages/BudgetPacing.tsx`: filter in the `computed` memo — both the `metrics` scoping filter (line ~204) and `activeBudgetRows` (line ~214).
- No database or sync changes; `campaign_budgets` keeps storing all campaigns so nothing else that reads it is affected. Google Ads spend totals elsewhere on the site are untouched.
