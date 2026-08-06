# Budget Pacing: no rows for DFW and Central Illinois

## Why it happens

The Budget Pacing table only renders budget rows that were manually created. Five properties have one row each; DFW and Central Illinois have none — so they never appear, even though their Google Ads spend and campaign budgets are syncing normally.

## Fix

1. Add the two missing budget rows now:
   - Ridgeside K9 DFW — monthly budget $2,000
   - Ridgeside K9 Central IL — monthly budget $540
2. Make the page self-healing: on load, any active property without a budget row gets one created automatically (budget $0, no campaign label), so a newly added property always shows up and can be edited inline instead of silently vanishing from the table.

## Technical notes

- Data change: insert two `budget_accounts` rows with the amounts above and the next `sort_order`.
- `src/pages/BudgetPacing.tsx`: after `reloadRows`, compare the scoped property list against fetched rows and insert placeholder rows for any property with none, then reload. Guard so only users with write access (super admin) perform the insert; read-only roles just see existing rows.
