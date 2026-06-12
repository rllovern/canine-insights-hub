The duplicate happens because the report renders the same two charts in two places:

1. `src/pages/Dashboard.tsx` renders:
   - Cost / Good Lead
   - Cost / Good Lead by Source

2. `src/pages/CallTracking.tsx` renders the same pair again inside the `Lead Quality` section.

Plan:

1. Remove the duplicated `Cost / Good Lead` and `Cost / Good Lead by Source` charts from the `Lead Quality` section in `src/pages/CallTracking.tsx`.
2. Keep the original pair in the main `Cost / Good Lead` section so the metric still appears once.
3. Leave the rest of `Lead Quality` intact, including good leads, admissions, spam monitoring, source performance, and campaign breakdowns.

Technical detail:
- This is a frontend-only cleanup. No data queries, formulas, backend logic, or date-range behavior will change.