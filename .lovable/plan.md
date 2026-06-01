## Fix CTM sync auth error

**Root cause:** Edge function logs show:
```
TypeError: anon.auth.getClaims is not a function
  at sync-ctm/index.ts:99
  at sync-google-ads/index.ts:55
```

The auth guard added in the security pass calls `anon.auth.getClaims(token)`, but the sync functions pin `@supabase/supabase-js@2.45.0`, which doesn't have `getClaims()` (it was added in 2.50+). So every manual sync from the UI (which sends a user JWT, not the service-role key) fails with a 500 before any CTM work happens. Scheduled runs work because they go through the service-role/CRON_SECRET branch.

**Fix:** Replace `auth.getClaims(token)` with `auth.getUser(token)` in all four sync functions. `getUser` exists in 2.45.0 and returns `{ data: { user }, error }` — we use `user.id` for the `has_role` check.

### Changes
1. `supabase/functions/sync-ctm/index.ts` — swap `getClaims` → `getUser`, read `user.id`.
2. `supabase/functions/sync-google-ads/index.ts` — same.
3. `supabase/functions/sync-ga4/index.ts` — same.
4. `supabase/functions/sync-keyword-com/index.ts` — same.
5. Deploy all four functions.
6. Verify: trigger CTM sync from the dashboard, confirm 200 + a row in `sync_runs`. Confirm scheduled run path (service key / CRON_SECRET) still short-circuits correctly.

No DB / RLS / secrets changes. Scheduled sync (`scheduled-sync-all`) already uses the service-role branch and is unaffected.
