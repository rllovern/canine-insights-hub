
# Viewer experience rebuild + Bob impersonation

## 1. Nav scoping — viewers see only Command + Budget Pacing

`src/components/layout/Sidebar.tsx`
- When `effectiveRole !== "internal"`:
  - Render only two items: **Command** (`/command`) and **Budget Pacing** (`/budget`).
  - Hide the Monitor group (PPC Overview, Call Tracking, Lead Performance), Deliver group (Reports, Performance Reports), Jarvis, and the entire Admin section.
- Internal users keep everything exactly as today.
- The current `internalOnly` flag on Budget Pacing is removed so viewers can reach it; route guard updated to match (see §2).

`src/App.tsx`
- Remove `requireRealRole="internal"` from `/budget`.
- Wrap viewer-forbidden routes (`/dashboard`, `/calls`, `/keywords`, `/reports`, `/assistant`, `/lead-performance`, `/properties/:slug`) with a small guard that redirects viewers to `/command`. Internal users (and internal-previewing-as-viewer is fine because they're still real internal) keep access. Implemented as a thin `<ViewerBlock>` wrapper reading `realRole`.

## 2. New Command page for viewers (single combined surface)

Goal: one page that opens at `/command` and stacks the existing Command hero on top of the existing PPC Overview cards + Call Tracking report — no new analytics work, just composition.

`src/pages/Command.tsx`
- Keep the existing top block: KPI tiles (Ad Spend, Records, Qualified, AI-Projected), `JourneyFunnel`, `PortfolioVerdict`, and the Business/Ads toggle.
- **Remove** for everyone on this page:
  - `CallHandlingCard`, `MissedCallFollowUpCard`, `CallQualityCard` (the 3 PendingCards).
  - `TopOpportunities` block.
- **Append a new "Performance Report" section below** the funnel/verdict row:
  - Reuse the Dashboard.tsx body (Cost / Avg CPM / Impressions + Cost vs CPM chart, Clicks / CTR / Avg CPC + Clicks vs CTR chart, Actions KPIs + Impressions vs Calls chart) by extracting it into `src/components/performance/PpcOverviewSection.tsx` and importing it into Command.
  - Reuse the CallTracking.tsx body (Total Calls, Calls by Source, Lead Quality, Source Performance table, Campaign Breakdown table; Spam Monitoring stays gated to internal as today) by extracting it into `src/components/performance/CallPerformanceSection.tsx`.
  - `src/pages/Dashboard.tsx` and `src/pages/CallTracking.tsx` are rewritten to thin wrappers that render the new section components, so internal users see no change on those routes.

No metric math changes. Canonical lead model, Ads/Business toggle, date picker, and scope all flow through unchanged.

## 3. "View as Bob" impersonation toggle (only on your account)

Behavior chosen: in-session impersonation, no auth switch. Toggle renders only when the logged-in email matches an owner allowlist.

New file `src/lib/owners.ts`
- Exports `OWNER_EMAILS: string[]` — single source of truth. Initial value: the account email you sign in with (I'll need you to confirm it; placeholder `["you@example.com"]` until then).
- Exports `BOB_EMAIL = "bob@demo.rsk9insights.com"` and `BOB_USER_ID` (the uuid created in §4).

Extend `src/contexts/PreviewModeContext.tsx`
- Add `impersonateBob: boolean`, `toggleBob: () => void`, persisted to `localStorage` under `preview.bob`.
- When `impersonateBob` is true AND the real user email is in `OWNER_EMAILS`:
  - `effectiveRole` becomes `"viewer"`.
  - Expose `impersonatedUserId = BOB_USER_ID` (otherwise null).
- Otherwise behaves exactly as today.

`src/contexts/PropertyContext.tsx`
- When `impersonatedUserId` is set, load properties by joining `viewer_property_access` for Bob's user id instead of the real user. Internal "all properties" path is bypassed.

`src/contexts/ScopeContext.tsx` — no change needed; it already restricts viewers to their accessible properties via the new property list.

`src/components/layout/TopBar.tsx`
- Add a small pill on the right: `View as Bob` switch. Renders only when `OWNER_EMAILS.includes(user.email)`. Hidden for everyone else (including all viewers and other internal staff). Sits next to the existing Internal/Client preview switch.
- When on, the existing Internal/Client switch is hidden to avoid two competing toggles.

`src/components/RequireAuth.tsx`
- No change. `requireRealRole` still gates admin routes by real role — Bob impersonation cannot reach admin pages.

## 4. Bob dummy user (DB)

Migration:
- Create `auth.users` row via `supabase.auth.admin.createUser` is not available in a SQL migration; instead the migration will:
  1. Assume Bob's auth user is seeded once via a tiny edge function `seed-bob` (one-shot, internal-only) that calls `supabase.auth.admin.createUser({ email: "bob@demo.rsk9insights.com", password: <random>, email_confirm: true })` and writes the resulting uuid into a new row in `public.app_constants(key text primary key, value text)`.
  2. Insert `user_roles(user_id = <bob_uuid>, role = 'viewer')`.
  3. Insert `viewer_property_access(user_id = <bob_uuid>, property_id)` for **all 5 active properties** via `SELECT id FROM properties WHERE is_active = true`.
- After running `seed-bob` once, I'll hard-code `BOB_USER_ID` into `src/lib/owners.ts` so the client doesn't need to query for it.

Bob never logs in directly — his credentials exist only so the auth.users row is valid for FK constraints on `user_roles` and `viewer_property_access`.

## Technical notes

- The `ViewerBlock` redirect in §1 is belt-and-suspenders: hiding nav items already prevents access from the UI, but a viewer who types `/calls` should bounce to `/command`.
- Extracted section components in §2 keep their existing `useDashboard` / `useScope` data sources, so Bob's narrowed property list automatically scopes everything correctly.
- All canonical lead-model rules (Total Leads = bad + good + projected; 55/45 tiers; small-sample floors) remain untouched.
- Internal users opening `/command` will see the same merged page as viewers — confirm if you want internal to keep the old Command (with Call Handling / Missed Call / Quality / Top Opportunities) or also adopt the merged layout. Default in this plan: **merged layout for everyone** since you said those cards should be removed.

## Open items I need from you

1. **Your account email** (the one address that should see the "View as Bob" toggle). I'll put it in `OWNER_EMAILS`.
2. Confirm internal users should also lose Call Handling / Missed Call / Call Quality / Top Opportunities on `/command`, or keep them for internal only.
