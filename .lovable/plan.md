## Plan

1. **Remove location switching for Location Owner**
   - In the sidebar scope selector, show the assigned location as read-only when the effective role is `location_owner`.
   - Hide the dropdown/combobox behavior so a Location Owner cannot choose “All locations” or switch to another location.
   - Keep Super Admin’s top-right role preview dropdown intact; only the location selector is removed/locked for Location Owner view.

2. **Force Budget Pacing to the assigned location**
   - Update Budget Pacing to use the existing scope/property context instead of loading all budget rows.
   - When the effective role is `location_owner`, filter budget accounts, daily metrics, Google Ads budgets, labels, and sync targets to only the assigned property.
   - This will make the Ashtabula Location Owner view show only Ashtabula ad spend and performance.

3. **Remove non-Super Admin budget actions**
   - Hide or disable `Sync budgets`, `Add Account`, inline budget edits, notes/label edits, and delete actions unless the effective role is `super_admin`.
   - Admin, Owner, and Location Owner remain read-only on Budget Pacing.

4. **Backend policy alignment for budget accounts**
   - Add a database migration so `budget_accounts` read access is property-scoped with `can_access_property(...)`, matching `daily_metrics`, `campaign_budgets`, and `campaign_labels`.
   - This prevents a real Location Owner from reading budget rows for unrelated locations even if the frontend is bypassed.

5. **Validate**
   - Check TypeScript.
   - Verify the Location Owner preview no longer has a location dropdown and Budget Pacing only renders the assigned location’s row.