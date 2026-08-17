# Bob Conversation Log (Super Admin only)

A hidden hub where a Super Admin can pick a user and read every question they have asked Bob, plus Bob's answers.

## What gets built

**New page: Bob Logs (`/admin/bob-logs`)**
- Two-pane layout. Left: list of users who have talked to Bob, with name/email, number of conversations, and when they last asked something. Right: that user's conversations, newest first, each expandable into the full back-and-forth (their question, Bob's reply, the location and date range that was selected at the time).
- Search box for filtering users, and a search across message text.
- Read-only. No editing or deleting from this screen.
- Appears in the sidebar only for Super Admin, alongside Users / Settings, and the route is guarded by `requireSuperAdmin` so a URL guess by anyone else bounces to `/command`.

**Access tightening**
- Today the stored conversations are readable by any staff account (Admin as well as Super Admin). That is broader than asked. Read access will be narrowed to Super Admin only.

**Bob prompt change**
- Bob will be explicitly barred from offering follow-ups about which training programs, classes, or services are driving interest or demand — he has no program-level data. His follow-up suggestions stay inside what he can actually answer: records, scored calls, good calls, cost per good call, spend, sales, and month-over-month movement.

## Technical detail

- Data already exists: `ai_agent_sessions` (user_id, property_id, page_context, date range, created_at) and `ai_agent_messages` (role, content, created_at), written by the `jarvis` function. No schema change needed.
- Migration: replace the SELECT policies on `ai_agent_sessions` and `ai_agent_messages` so the non-owner branch uses `is_super_admin(auth.uid())` instead of `is_staff(auth.uid())`. Owner self-read stays intact so Bob keeps working for everyone.
- Emails/names come from the existing `admin-users` edge function `list` action (already Super Admin gated); joined client-side to `user_id`. Property names come from `properties`.
- New file `src/pages/admin/BobLogs.tsx`, route in `src/App.tsx` under the `AppShell` block with `RequireAuth requireSuperAdmin`, nav entry in `src/components/layout/navItems.ts` with `superAdminOnly: true`.
- Prompt edit in `supabase/functions/jarvis/index.ts` (follow-up guardrails section), then redeploy the function.
