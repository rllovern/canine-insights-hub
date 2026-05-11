## Diagnosis

The synced call's reporting tag in CTM is **"SPAM / Dead Air / Hangup"**, and `sync-ctm` is correctly extracting that label from the payload (`sale.name`). The reason it's currently classified as **no_entry** is that the property has **zero rows** in `property_call_score_mappings` — there's no rule that says "this label → spam bucket".

Verified in the DB:

```
property_call_score_mappings for Ashtabula → 0 rows
ctm_calls row → call_score_label = "SPAM / Dead Air / Hangup", call_score_bucket = "no_entry"
sale.name in raw_payload = "SPAM / Dead Air / Hangup"
```

So two real issues:

1. **No UI exists to manage the reporting-tag → bucket mapping.** Mappings have to be defined for the dashboard cards to populate (Spam, Good Leads, Bad Leads, Sale, Medicaid, No Entry). Once mapped, all cards auto-fill from the same `daily_metrics` aggregation — that part of the pipeline is already correct.
2. **The "Boarded" label** (default for the `admissions` metric) should be renamed to **"Sale"** globally.

The card framework itself is fine — `Total Spam`, `Good Leads`, `Bad Leads`, `Sale`, etc. are already driven by the per-bucket counts produced by sync-ctm's classifier. They show zero because nothing has been mapped yet.

## Plan

### 1. Rename "Boarded" → "Sale" (global default)

`src/lib/property-labels.ts`: change `DEFAULT_METRIC_LABELS.admissions` from `"Boarded"` to `"Sale"`. Per-property overrides via `properties.metric_labels` continue to work.

The underlying DB column stays `admissions` and the internal bucket key stays `"admission"`. Pure label swap.

### 2. Add a "Reporting Tag Mappings" panel inside the CTM Connection dialog

This is the most discoverable place — the user is already there to manage CTM. New section appears once the connection is connected:

- Lists every distinct `score_label` already seen on synced `ctm_calls` for this property, plus any rows already in `property_call_score_mappings`. Each row shows `<label>` + a dropdown of buckets:
  - `sale` (formerly "admission" — same DB value, relabeled in UI)
  - `good` (good lead)
  - `bad` (bad lead)
  - `medicaid`
  - `spam`
  - `repeat` (excluded entirely)
  - `no_entry` (counts as a lead but uncategorized)
  - `ignore` (drop)
- "Add label" button for labels that haven't appeared in synced data yet.
- "Save mappings" upserts into `property_call_score_mappings` (lowercased key, priority defaults to 100).
- After save: automatically re-run `sync-ctm` for the same range so existing `ctm_calls` get re-classified and `daily_metrics` rebuilt with the new buckets. (Sync is idempotent on the unique key, so re-running is safe.)

For Ashtabula's case: user opens the dialog → sees `SPAM / Dead Air / Hangup` already listed → picks `Spam` → Save → sync re-runs → Direct now shows `record_count: 1, spam: 1, leads: 0`. The "Total Spam" card will show **1**, "No Entry" drops to **0**.

### 3. Seed sensible default mappings on first connect

When a brand-new CTM connection is created (no mapping rows yet), insert a starter set of common Ridgeside labels so the dashboard isn't empty out of the gate:

- `SPAM / Dead Air / Hangup`, `Spam`, `Hangup`, `Dead Air` → **spam**
- `Sale`, `Boarded`, `Admission` → **sale** (admission)
- `Good Lead`, `Qualified Lead` → **good**
- `Bad Lead`, `Unqualified` → **bad**
- `Medicaid` → **medicaid**
- `Repeat Caller`, `Repeat` → **repeat**

User can edit/remove any of these in the dialog.

### 4. Verification

1. Open CTM dialog for Ashtabula → Reporting Tag Mappings shows `SPAM / Dead Air / Hangup`.
2. Map → Spam → Save → sync re-runs.
3. `ctm_calls.call_score_bucket` for that call becomes `spam`.
4. `daily_metrics` row: `record_count = 1`, `spam = 1`, `no_entry = 0`, `leads = 0`.
5. Call Tracking page: "Total Spam" card = 1, "No Entry" = 0, source row "Direct" reflects the same.
6. `admissions` KPI card on the dashboard now reads "Sale" instead of "Boarded".

### Out of scope

- A standalone Score Mappings page in Admin Settings (we're adding it inside the CTM dialog only — that's where the user already is).
- Bucket renames at the database level. `admissions` column and `admission` bucket value stay as-is; only the display label changes.
- Other sync functions (Google Ads / GA4 / Keyword.com) — they still use the dead `client_data_sources` schema, but that's a separate task.
