## Diagnosis

Looking at the DB right now:

- `property_call_score_mappings` for Ashtabula → **still 0 rows**. The seeding code I added only fires on a **brand-new** connect (when `!source`). Ashtabula's connection already existed, so it never seeded, and you also haven't opened the dialog and saved mappings yet. That's why the call is still classified as `no_entry`.
- `daily_metrics` for Ashtabula → 1 row, `record_count: 1, no_entry: 1, spam: 0` — correct given empty mappings.

So nothing's broken in the pipeline; the mappings just don't exist yet for this property. Two real changes needed:

1. **Drop Medicaid** everywhere it's user-visible.
2. **Lock the canonical 7-label seed** to the exact spelling/casing you gave, and **apply it to Ashtabula now** (not just future connections), then re-sync.

## Plan

### 1. Drop Medicaid from the product

- `src/lib/property-labels.ts`: remove `medicaid` from `CUSTOMIZABLE_METRIC_KEYS` and `DEFAULT_METRIC_LABELS`.
- `src/components/data/CTMConnectionDialog.tsx`: remove `medicaid` from the bucket dropdown (`Bucket` type, `BUCKET_TO_DB`, `DB_TO_BUCKET`, `BUCKET_LABELS`).
- `supabase/functions/sync-ctm/index.ts`: remove `medicaid` from the `Bucket` union and classifier so it can never be assigned. (DB column stays — leaving the column avoids a migration; it'll just always be 0 going forward.)
- Other files (`metrics.ts`, `data-sources.ts`, `sync-ga4`, `sync-google-ads`) only reference the `medicaid` column passively in interfaces/sums. Leave the column references in `MetricRow` interfaces so existing rows still parse, but don't surface it anywhere in UI.
- Verify no remaining UI text or column shows "Medicaid".

### 2. Replace the seed list with the canonical 7 labels

In `CTMConnectionDialog.seedDefaultMappings`, replace the current seeds with exactly these (matching your spelling/casing):

| Reporting Tag | Bucket |
|---|---|
| `Sale` | sale (= `admission` in DB) |
| `Good Lead` | good |
| `Bad Lead` | bad |
| `Repeat Caller` | repeat (excluded entirely from leads) |
| `Misc` | no_entry (counts as a real call, uncategorized) |
| `Wrong Number` | spam (non-lead noise, doesn't count as a lead) |
| `SPAM / Dead Air / Hangup` | spam |

(If you want `Misc` or `Wrong Number` mapped differently, say so before I implement and I'll swap them.)

### 3. Apply the seed to Ashtabula right now and re-sync

Since Ashtabula already has a connection, the seed-on-connect path won't run. I'll directly insert these 7 mapping rows for Ashtabula via the data tool, then call `sync-ctm` for Ashtabula. Result: the existing call's `call_score_bucket` flips from `no_entry` to `spam`, and `daily_metrics` becomes `record_count: 1, spam: 1, no_entry: 0, leads: 0`.

### 4. Verification

1. CTM dialog opens → Reporting Tag Mappings shows the 7 canonical rows.
2. No "Medicaid" anywhere — not in the bucket dropdown, not as a metric label, not in any card or table.
3. `select * from daily_metrics where property_id = 'ea92c5ce-…'` → `spam = 1, no_entry = 0`.
4. Call Tracking page: "Total SPAM" shows 1, "No Entry" shows 0.

### Out of scope

- Dropping the `medicaid` column from `daily_metrics` (would need a migration; the column going unused is harmless and reversible).
- Touching other sync functions' schema mismatches.
