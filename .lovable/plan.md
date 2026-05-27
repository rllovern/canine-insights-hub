## Security fixes

### 1. Disable public registration (replaces invite-code flow)
- Delete `src/pages/Register.tsx` and remove its route from `src/App.tsx`.
- Remove the "Create account" link from `src/pages/Login.tsx`.
- Delete the `supabase/functions/grant-internal-role` edge function (no longer needed).
- Call `configure_auth` with `disable_signup: true` so the API also refuses signups.
- New internal users will be created by you directly (insert into `user_roles` via the admin UI or DB).

### 2. Drop the privilege-escalation RLS policy
Migration:
```sql
DROP POLICY IF EXISTS "Self insert internal via invite (app-enforced)" ON public.user_roles;
```
(Already done in a prior migration — re-asserted defensively.)

### 3. Add auth to `ai-assistant` edge function
At the top of `supabase/functions/ai-assistant/index.ts`:
- Require `Authorization: Bearer …` header.
- Validate via `supabase.auth.getClaims(token)`; return 401 if invalid.
- Keep CORS headers on all responses.

### 4. Add auth to on-demand sync functions
For `sync-google-ads`, `sync-ctm`, `sync-ga4`, `sync-keyword-com`:
- Require Bearer JWT.
- Verify user via anon-key user client.
- Check `has_role(user.id, 'internal')` via RPC; return 403 if not internal.
- Service-role client still used for the actual DB writes.

### 5. Protect `scheduled-sync-all`
- Require `Authorization: Bearer $CRON_SECRET` header.
- Add new secret `CRON_SECRET` (I'll prompt for it — generate any strong random string).
- Update the pg_cron job command to send that header.

### 6. SECURITY DEFINER advisories
- `get_public_report_token` / `get_public_report_token_url` and the `public_report_*` / `get_*_by_report_token` functions are intentionally callable by `anon` (that's how tokenized public reports work). Mark these two scanner findings as **ignored** with explanation, and update security memory to record the accepted risk.

### 7. `property_data_sources` viewer-no-access warning
- Confirmed intentional (refresh tokens must stay internal-only). Mark as ignored; note in security memory.

### Technical notes
- `disable_signup: true` blocks `auth.signUp` API calls platform-wide. To add a new internal user afterwards: create the auth user from the Cloud Users panel, then insert `(user_id, 'internal')` into `user_roles`.
- `CRON_SECRET` will be stored as a Supabase secret; the cron job SQL will be updated via migration to include `headers := '{"Authorization":"Bearer …"}'::jsonb` in the `net.http_post` call.
