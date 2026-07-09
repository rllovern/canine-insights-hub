## Switch Verified Sales to GHL (won opportunities)

Great news: your `ghl_opportunities` table already stores a `won_at` timestamp, populated for all 1,274 current won rows. We don't need to touch stage history or add a new sync — the transition date is already there.

### Change

Rewrite `fetchVerifiedSalesByDate` in `src/lib/verified-sales.ts` so it reads from `ghl_opportunities` instead of `sheet_sales`:

- Filter `status = 'won'` and `won_at` between the requested `from`/`to` (converted to timestamptz day bounds).
- Group by the calendar date of `won_at` and return `Record<date, count>`.
- Scope by `property_id` (same as today).

### Ripple effects (no logic change, just the source swap)

Every caller of `fetchVerifiedSalesByDate` / `useVerifiedSalesTotal` / `useVerifiedSalesByDate` automatically switches to GHL. That covers:

- Command page (`useCommandData` — both Business and Ads modes)
- Any KPI/chart currently pulling "Sales" via those helpers

**Call Tracking is unaffected** — it reads `daily_metrics.verified_sale` directly, per the comment already in `verified-sales.ts`.

### What we're NOT changing

- `sheet_sales` table and `sync-sheet-sales` edge function stay in place (archival), but no UI reads from them anymore.
- `daily_metrics.verified_sale` remains the Call Tracking source.
- No schema migration required.

### Technical detail

```ts
// New fetchVerifiedSalesByDate body (sketch)
let q = supabase
  .from("ghl_opportunities")
  .select("won_at")
  .eq("status", "won")
  .gte("won_at", `${from}T00:00:00.000Z`)
  .lte("won_at", `${to}T23:59:59.999Z`);
if (propertyIds) q = q.in("property_id", propertyIds);
// bucket by won_at::date in JS
```

Timezone note: `won_at` is timestamptz. Bucketing by UTC calendar date is the simplest and matches how `sheet_sales.sale_date` was treated. If you want local-timezone bucketing later, we can layer that on.

### Verification

- Compare Command-page "Sales" totals for a recent range against a direct count of `ghl_opportunities` where `status='won'` in that window.
- Confirm Call Tracking numbers are unchanged.
