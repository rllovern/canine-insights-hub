# Fix Source Performance / Campaign Breakdown columns

Scope: only the **Source Performance** and **Campaign Breakdown** tables on the Call Tracking page (`src/pages/CallTracking.tsx`). No other card, chart, KPI, or stored metric changes. Display-only — no database or sync changes.

## What is actually wrong

The numbers are not miscomputed, they are double-counted on screen. At ingest, a call dispositioned **Spam** is counted as spam *and* added into **Bad Leads**. So for Google PPC: 7 spam are 7 of the 8 bad leads, and 8 bad + 3 good = 11 records. The row looks like 18 leads against 11 records only because spam is being read as a separate bucket when it is nested inside bad.

Separately, **Total Leads** is a second, differently-defined total (bad + good + projected, excluding no-entry) sitting next to Records, which makes the row look internally inconsistent.

## Changes

1. **Remove the Total Leads column** from both tables. Records stays as the total.
2. **Split Spam out of Bad Leads in these two tables only.** Bad Leads renders as `bad_leads - spam` (floored at 0), so Spam and Bad Leads are mutually exclusive dispositions.
3. **Reconcile to Records.** Columns become: Ad Source / Records / No Entry / Spam / Bad Leads / Good Leads / Verified Sale, where No Entry + Spam + Bad + Good = Records.
4. **Residual guard.** Records also includes "scored but uncategorized" calls that land in no bucket. If a row's four buckets fall short of Records, the difference is shown in a small **Unclassified** column so the row always sums; if the residual is zero everywhere in view, the column is hidden.
5. Sorting, prior-period deltas, and Grand Total recompute off the adjusted values, so the arrow colors follow the split numbers.

## Technical notes

- Change is local to `src/pages/CallTracking.tsx` where source and campaign rows are mapped (currently setting `total_leads: rowTotalLeads(r)`), plus the two column definition lists.
- `rowTotalLeads` / `leadModel.ts` are left untouched so every other surface keeps its current definitions.
- Existing label-rule filtering, hidden-column config (`cfg.isHidden`), and Verified Sale attribution stay as-is.
