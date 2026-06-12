## Two fixes for Budget Pacing

### 1. Inline cells should look like plain text

Remove the bordered input look on Budget, Campaign Label, and Notes cells. They should render as normal table text. Clicking a cell turns it into an editable input; blurring (or pressing Enter) saves and reverts to plain text. Same behavior, cleaner look — no more colored boxes around every cell.

Implementation: small `EditableCell` / `EditableNumberCell` component that toggles between a `<span>` and an `<Input>` on click. Uses `bg-transparent border-0 px-0 focus-visible:ring-0` for the in-edit state so it blends with the table.

### 2. Campaign Label should match real Google Ads labels

Today the page does a substring match on `daily_metrics.campaign` name. Switch to using actual Google Ads labels attached to campaigns.

Schema:

```sql
CREATE TABLE public.campaign_labels (
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  campaign text NOT NULL,        -- campaign name (matches daily_metrics.campaign / campaign_budgets.campaign)
  label_name text NOT NULL,
  synced_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (property_id, campaign, label_name)
);
-- GRANT + RLS: internal-only read, service role full access.
```

`sync-google-ads` extension: after the metrics + budget queries, run
`SELECT campaign.name, label.name FROM campaign_label WHERE campaign.status != 'REMOVED'`,
delete + re-insert that property's rows in `campaign_labels`.

Frontend:
- `BudgetPacing.tsx` loads `campaign_labels`, builds a `Map<property_id, Map<label_name_lower, Set<campaign_name>>>`.
- New helper `matchesLabel(propertyId, campaign, label)`:
  - If `label` is empty → include all campaigns (unchanged).
  - Else → include only campaigns in that property's label set. If the label exists in Google Ads but matches nothing, sum is `0`. If we have no label data for the property yet (sync hasn't run), fall back to substring match so existing rows don't break.
- Use the same logic for `daily_metrics` (Spends, Yesterday, Last 5) and `campaign_budgets` (Active Budget).
- Help text in the Add dialog updated: "Match Google Ads campaigns that carry this label."

Out of scope: a dropdown of known labels (free text for now); editing labels in Google Ads from this UI.
