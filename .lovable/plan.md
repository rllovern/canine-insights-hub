## Sale Records page

Add a new `/sales` page listing every won opportunity for the active scope and date range, and make the Verified Sale KPI card on Command open it.

### Navigation
- New sidebar item **Sale Records** (icon: `Receipt`) in the "EXECUTIVE VIEW" group of `src/components/layout/Sidebar.tsx`, visible to every role (Super Admin, Admin, Owner, Location Owner — no `staffOnly`/`superAdminOnly` flag). Also shown in the minimal nav used by Owner / Location Owner.
- New route `/sales` in `src/App.tsx` inside the authenticated `AppShell`, wrapped in `<ViewerBlock>` so scope/date filters apply.

### Verified Sale card → link
- On `src/pages/Command.tsx`, wrap the "Verified Sale" / "PPC Verified Sale" / "PPC Sales" `KpiSparkCard` in a `<Link to="/sales">` (owner-view "Sales (count)" card links to the same page). Cursor pointer + hover treatment; no other card behavior changes.

### Page: `src/pages/SaleRecords.tsx`
- Uses existing `useScope()` (property filter) and `useDateRange()` — same filters the Verified Sale KPI already respects, so counts match.
- Query `ghl_opportunities` where `status = 'won'` and `won_at` inside `[from, to]`, joined to `ghl_contacts` via `(property_id, contact_id → ghl_contact_id)` to hydrate name / phone / email. Order by `won_at desc`.
- Columns:
  - **Name** — `first_name + last_name` from contact (fallback to raw name on the opportunity)
  - **Phone** — from contact
  - **Email** — from contact
  - **Created** — `ghl_created_at` on the opportunity (date the opportunity was created)
  - **Sold** — `won_at`
  - **Amount** — `monetary_value`, formatted as currency (blank when null)
- Property column shown when scope covers more than one property.
- Header with `PageHeader` ("Sale Records", description showing range + count), CSV export button, and empty state when zero rows.
- Totals row: count of records and sum of `monetary_value`.

### Technical notes
- Fetch via `@tanstack/react-query`; new helper `fetchSaleRecords(propertyIds, from, to)` colocated in `src/lib/verified-sales.ts` reusing the same date-window logic so the list length equals the KPI count.
- Contacts join done in a second `in("ghl_contact_id", ids)` query and merged in JS (existing tables have RLS that already filters by property access; no schema changes needed).
- No database migration required — all fields exist on `ghl_opportunities` / `ghl_contacts`.
- Currency: `Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })`.

### Files touched
- `src/App.tsx` — add route.
- `src/components/layout/Sidebar.tsx` — add nav item (visible to all roles, including minimal nav).
- `src/pages/Command.tsx` — wrap Verified Sale card in link.
- `src/pages/SaleRecords.tsx` — new page.
- `src/lib/verified-sales.ts` — add `fetchSaleRecords` + hook.
