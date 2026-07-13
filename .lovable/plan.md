
## Diagnosis

Sales bucket by two different date systems:

- **30-day list** (`SaleRecords` rows table, `SalesDayDrawer`) uses local browser time — `format(new Date(r.won_at), "yyyy-MM-dd")`.
- **Sales cadence heatmap** and **Revenue Runway daily aggregate** use UTC — `r.won_at.slice(0, 10)`.

For a US-Eastern (UTC-4) user, any sale won between 20:00–23:59 local (00:00–03:59 UTC the next day) lands one calendar day later on the heatmap/runway than in the list. That's exactly what's happening on July 10: DB has `won_at` values like `2026-07-11T02:06:57Z`, `T01:41:17Z`, `T01:50:04Z`, `T01:34:04Z`, `T01:55:05Z` — all July 10 evening in local time — plus `2026-07-10T23:37:42Z` and earlier same-day sales. The list groups them as July 10; the heatmap/runway pushes them to July 11.

The Revenue Runway loop also generates its day keys with `isoDay()` (local calendar), so UTC-keyed aggregates literally miss the correct bucket entirely on affected days.

## Fix

Standardize sold-date bucketing on **the same local-day formatter the sales list already uses**, everywhere sales are grouped by day. Purely presentational — no backend, no query change.

### 1 — Shared helper

Add `localDayKey(iso: string): string` to `src/lib/verified-sales.ts` (next to the existing `isoDay`):

```ts
export function localDayKey(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
```

Export it so all three call sites share one implementation.

### 2 — Replace UTC slicing at three call sites

- `src/components/sales/SalesHeatmap.tsx` line 133 — `r.won_at.slice(0, 10)` → `localDayKey(r.won_at)`
- `src/pages/SaleRecords.tsx` line 89 (the `actualByDay` map fed into `buildRunwaySeries`) — same substitution
- `src/lib/verified-sales.ts` line 27 in `useWonDealCounts` — same substitution (this feeds any daily-count consumer)

### 3 — Range query stays UTC

`ghl_opportunities.won_at` is a `timestamptz`, so the DB range filters (`.gte("won_at", fromT00:00:00Z)`) must stay in UTC — otherwise we'd narrow the fetch and miss rows. Only the *grouping* changes, not the fetch window. A sale at `2026-07-11T02:06Z` is still fetched by a "through 2026-07-10" filter as long as `to = 2026-07-10T23:59:59Z` is applied to a period that ends on July 11 UTC — and today's queries already use `${to}T23:59:59.999Z`, which gives Eastern users the day of local overlap they need. No fetch-window change required.

### 4 — Test

Add one unit test to `src/lib/__tests__/revenueRunway.test.ts`:

- Given a sale with `won_at = "2026-07-11T02:00:00.000Z"` in a runway window July 1–31, `actualByDay["2026-07-10"]` (derived via `localDayKey`) receives the revenue and the July 10 point in the built series is non-zero.

Skip a timezone-mocking fixture — the test just asserts `localDayKey` reproduces the same value `format(new Date(iso), "yyyy-MM-dd")` returns for a given input in the runtime timezone.

## Files touched

- `src/lib/verified-sales.ts` — add `localDayKey`; use it in `useWonDealCounts`
- `src/components/sales/SalesHeatmap.tsx` — use `localDayKey`
- `src/pages/SaleRecords.tsx` — use `localDayKey`
- `src/lib/__tests__/revenueRunway.test.ts` — one regression test

## Not doing

- Not switching to a property-configured timezone. Every consumer today already reads browser-local dates for display (`format(new Date(...))`) — matching that keeps the fix minimal and consistent with what the user sees in the list.
- Not touching CTM / daily_metrics daily aggregates — those already store `date` as a plain `date`, no time component, so they aren't affected.
