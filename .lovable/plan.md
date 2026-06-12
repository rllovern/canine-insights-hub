## Budget Pacing page

A new internal-only page at `/budget` that mirrors the structure of your reference screenshot. Each row is an "account" = (property + optional campaign label). Internal users can add, edit, and delete rows and budgets. Viewers do not see this page.

### Columns

| Column | Source | Notes |
|---|---|---|
| # | row index | auto |
| Account Name | property name | from `properties.name` |
| Campaign Label | row config | optional; filters which `daily_metrics` rows count toward this account (matches `campaign` ILIKE `%label%`). Empty = all campaigns for that property. |
| Notes | row config | free text, editable inline |
| Budget | row config | editable inline (monthly) |
| Spends | computed | sum of `daily_metrics.cost` over selected period (default MTD) |
| % Spend | computed | spends / budget |
| Yesterday Spend | computed | sum of cost for yesterday |
| Active Budget | Google Ads sync (new) | sum of currently-enabled campaigns' daily budgets |
| Target Daily Spend | computed | `(budget − spends) / days_remaining_in_month` |
| Projection | computed | `spends + avg(last_5_days_spend) × days_remaining_in_month` |
| Proj Run Rate | computed | projection / budget |

Conditional formatting: % Spend, Projection, Proj Run Rate use a red→yellow→green gradient (green near 100%, red far from it), matching the reference's intent without copying the palette — uses existing semantic tokens.

### Date toggle
- Defaults to **Month-to-date** (current calendar month, 1st → today).
- Toggle: This month, Last month, custom month picker.
- Spends, % Spend, Yesterday Spend, Target Daily Spend, Projection, Proj Run Rate all reflect the selected month. "Yesterday" is always the most recent day inside that month (for past months, it's the last day of the month).
- Active Budget is always "current" (live state of campaigns); does not change with the toggle.

### Editing
- Internal-only: gated via `has_role(auth.uid(), 'internal')`.
- Inline edit for Budget, Notes, Campaign Label.
- "Add Account" button → modal: pick property, optional campaign label, monthly budget, notes.
- "Delete" on row hover.

### Active Budget from Google Ads
Extend the existing `sync-google-ads` edge function to also fetch each campaign's daily budget (`campaign_budget.amount_micros / 1e6`) and status (only `ENABLED` counts). Store a snapshot per `(property_id, campaign_name)` so we can sum it per row at read time and filter by the row's campaign label.

If the sync hasn't run yet or returns no data, Active Budget shows `—` instead of `$0` so it's obvious it's missing rather than zero.

---

## Technical details

### Schema (1 migration)

```sql
-- 1. Per-row budget configuration
CREATE TABLE public.budget_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  campaign_label text,           -- nullable; matches against daily_metrics.campaign ILIKE '%label%'
  notes text,
  monthly_budget numeric NOT NULL DEFAULT 0,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.budget_accounts TO authenticated;
GRANT ALL ON public.budget_accounts TO service_role;
ALTER TABLE public.budget_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "internal read"  ON public.budget_accounts FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'internal'));
CREATE POLICY "internal write" ON public.budget_accounts FOR ALL    TO authenticated USING (public.has_role(auth.uid(),'internal')) WITH CHECK (public.has_role(auth.uid(),'internal'));
CREATE TRIGGER budget_accounts_updated BEFORE UPDATE ON public.budget_accounts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2. Snapshot of current Google Ads campaign daily budgets (overwritten each sync)
CREATE TABLE public.campaign_budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  campaign text NOT NULL,
  daily_budget numeric NOT NULL DEFAULT 0,
  status text,                   -- ENABLED / PAUSED / REMOVED
  synced_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, campaign)
);
GRANT SELECT ON public.campaign_budgets TO authenticated;
GRANT ALL    ON public.campaign_budgets TO service_role;
ALTER TABLE public.campaign_budgets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "internal read" ON public.campaign_budgets FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'internal'));
```

### Edge function changes
- `sync-google-ads`: after fetching campaign performance, also query `campaign` resource for `campaign_budget.amount_micros` and `campaign.status`; upsert into `campaign_budgets` (delete + insert per property for a clean snapshot).

### Frontend
- New route `/budget` in `App.tsx`, sidebar item "Budget Pacing" (internal-only, like the Admin section).
- `src/pages/BudgetPacing.tsx`:
  - Loads `budget_accounts`, joins to `properties.name`.
  - Fetches `daily_metrics` for selected month, filters by `property_id` and (if `campaign_label`) `campaign` ILIKE.
  - Fetches `campaign_budgets` filtered the same way; sums `daily_budget` where status = ENABLED.
  - Computes all derived columns client-side.
- Reuses shadcn `Table`, `Input`, `Dialog`, `Button`. Inline edit on blur / Enter.
- Month toggle: simple `Select` (This month, Last month, plus 12 months back).
- Conditional cell coloring via tailwind utility based on thresholds.

### Out of scope
- Per-day historical Active Budget tracking. We only store the current snapshot.
- Non-Google ad sources for Active Budget (rows that only have non-Google spend will show `—`).
- Viewer access — internal-only for now.
