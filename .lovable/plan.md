## Switch GHL to per-location Private Integration tokens

GHL Private Integrations created at the agency level can't grant `contacts.readonly`, `conversations.readonly`, or `opportunities.readonly`. Those scopes only exist on Private Integrations created **inside each sub-account (location)**. So each property must bring its own token instead of sharing the agency-wide `GHL_PRIVATE_INTEGRATION_TOKEN`.

### UX changes

In `GHLConnectionDialog.tsx`:
- Replace the "Select a location from agency list" flow with a simple per-property setup:
  - **Location ID** text input (user pastes it from GHL sub-account settings)
  - **Private Integration Token** password input (user pastes the `pit-...` token created inside that sub-account)
  - Helper text with step-by-step instructions: "In GHL, open the sub-account → Settings → Private Integrations → Create new → check Contacts, Conversations, Conversation Messages, Opportunities (read) → copy token."
- Remove `list-ghl-locations` call and dropdown.
- On Save: call a new edge function `save-ghl-connection` that validates the token (calls `/locations/{id}` and one scope-gated endpoint), then stores it.
- Keep Sync now / Disconnect buttons. Add a **Test access** button that calls `check-ghl-access` for this property and shows per-scope results inline.

### Storage

Tokens are sensitive, so don't put them in `config` JSON (which is readable by anyone with row access). Two options:
- **(chosen)** Add a `secret_token` text column to `property_data_sources`, store the token there, and tighten RLS so only internal/admin roles can `SELECT` that column. Easiest, keeps everything per-property.
- Alternative: store one secret per property via the secrets API. Heavier and requires admin tooling.

Migration:
```sql
ALTER TABLE public.property_data_sources
  ADD COLUMN IF NOT EXISTS secret_token text;
-- existing RLS already restricts table to internal role; no policy change needed
```

### Edge function changes

- **New `save-ghl-connection`**: accepts `{ property_id, location_id, token }`, calls GHL `/locations/{location_id}` and `/contacts/search` (pageLimit 1) with that token to verify both reachability and required scopes, then upserts into `property_data_sources` with `config = { location_id }`, `secret_token = token`, `status = 'connected'`. Returns `{ ok, scope_results }`.
- **`sync-ghl`**: stop reading `GHL_PRIVATE_INTEGRATION_TOKEN`. Load `secret_token` and `config.location_id` from the row for the property. If missing → friendly error. Drop the `pit-` OAuth branch logic — every token is now a location-scoped PIT.
- **`check-ghl-access`**: accept `property_id`, load that property's token, test the same 4 endpoints, return per-scope pass/fail.
- **`list-ghl-locations`**: delete. No longer used.
- **`scheduled-sync-all`**: still calls `sync-ghl` per property; just verify it doesn't pass any global token assumption.

Existing `GHL_PRIVATE_INTEGRATION_TOKEN` secret can be left in place but is unused; we can delete it once everything is migrated.

### Migration of existing connections

The current single connected property will need to be re-saved with its sub-account's PIT token. The dialog will show empty token field if `secret_token` is null and display a banner: "Re-enter this location's Private Integration Token to continue syncing."

### Files touched
- `supabase/migrations/<new>.sql` — add `secret_token` column
- `supabase/functions/save-ghl-connection/index.ts` — new
- `supabase/functions/sync-ghl/index.ts` — use per-property token
- `supabase/functions/check-ghl-access/index.ts` — accept `property_id`, use per-property token
- `supabase/functions/list-ghl-locations/index.ts` — delete
- `src/components/data/GHLConnectionDialog.tsx` — new inputs, Test access button, migration banner
