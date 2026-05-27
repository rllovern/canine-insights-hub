# Reuse MCC + CTM accounts across multiple properties

## Goal
Let the same Google Ads (MCC) customer **and** the same CTM sub-account be attached to more than one property — so spend / call data can be blended into multiple client reports.

## Today's behavior
- DB already permits it: `property_data_sources` is unique on `(property_id, source)` only, not on `external_account_id`. So the same MCC customer can technically link to many properties.
- The MCC Import dialog actively **blocks** it: rows that are already linked are auto-unchecked and labeled "already linked", with no way to attach the same customer to another property.
- There is **no agency-style picker for CTM**. CTM is only configurable per-property by manually entering `account_id` + `api_token` + `api_secret` in `CTMConnectionDialog`. There's no "Import from CTM agency" flow even though `list-ctm-accounts` already exists.

## Changes

### 1. MCC Import — allow reuse
`src/components/data/MCCImportDialog.tsx`
- Stop auto-unchecking already-linked rows. Default-checked stays `false` for linked rows (to avoid accidental dupes), but the checkbox is enabled.
- Replace the "already linked" warning with the **list of property names** it's currently attached to (small muted text), so the user knows what they're blending with.
- Keep the upsert as-is (`onConflict: "property_id,source"`) — that already permits the same `external_account_id` on a different property because the conflict key doesn't include it.
- Adjust the loader to fetch `properties.name` joined to `property_data_sources` so we can show names per linked customer.

### 2. CTM Import dialog (new) — parallel to MCC
New file `src/components/data/CTMImportDialog.tsx`
- Same UX shape as MCCImportDialog: list sub-accounts from `list-ctm-accounts`, allow "Create new property" or "Attach to existing" per row, multi-select, show which properties each sub-account is already linked to, and allow reuse across properties.
- On import, upsert a `property_data_sources` row with `source: "ctm"`, `external_account_id: <ctm sub-account id>`, `is_connected: true`, `status: "connected"`, and `config: { account_id: <id>, account_name: <name>, use_agency_credentials: true }`.

`src/pages/admin/AdminProperties.tsx`
- Add an "Import from CTM" trigger next to the existing "Import from MCC" button, wired to the new dialog.

### 3. sync-ctm — fall back to agency credentials
`supabase/functions/sync-ctm/index.ts`
- When a property's CTM `config` lacks `api_token`/`api_secret` (or has `use_agency_credentials: true`), use the agency-level `CTM_API_ACCESS_KEY` + `CTM_API_SECRET_KEY` secrets (the same ones `list-ctm-accounts` already uses) and the `account_id` stored in `config.account_id` / `external_account_id`.
- Per-property tokens, when present, still take precedence (don't break existing manually-configured properties).

### 4. CTM per-property dialog — small note
`src/components/data/CTMConnectionDialog.tsx`
- When the source was attached via the agency import (no per-property tokens, `use_agency_credentials: true`), show a small badge: "Using agency CTM credentials". Token/secret fields remain optional overrides.

## Out of scope
- No schema migration (the existing unique constraint already allows reuse).
- No change to `sync-google-ads` — it already uses the agency MCC refresh token + `external_account_id` from the row, so multi-property attach works as-is.
- No change to billing/spend math — each property gets its own daily_metrics rows keyed on `(property_id, date, ad_source, campaign)`, so attaching the same customer to two properties produces duplicate metrics in each report, which is the intended "blend" behavior.
