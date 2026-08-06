# Guided Dashboard Walkthrough (Admin only)

A spotlight-style tour that walks an admin through the app page by page, in plain English, highlighting real cards on screen.

## Who and when
- Visible only to users with the strict `admin` role (not super_admin, not owner, not viewer).
- Runs automatically the first time an admin signs in.
- Always re-launchable from a "Help / Take the tour" button in the top header.
- Completion/dismissal is remembered per user in the database, so it never nags twice.

## How it feels
- The screen dims, one real card lights up, and a small bubble points at it with:
  - a short title ("Verified Sales"),
  - 1-3 short sentences in everyday language ("This is how many deals were actually sold in the date range you picked at the top."),
  - what to do with it ("Click it to see every sale.").
- Buttons: Back, Next, Skip tour, plus a "Step 4 of 22" counter and a progress bar.
- The tour navigates the user between pages automatically as it moves through the sections; the sidebar link for the current page is highlighted first so they learn where things live.
- If a highlighted card is not on screen, the tour scrolls to it. If it can't be found (e.g. no data), that step is skipped automatically so the tour never gets stuck.

## Tour outline (plain language)
1. Welcome - what this dashboard is for, one screen.
2. Orientation - the sidebar, the property/location picker, the date-range toggle (stressing that every number obeys these two controls).
3. Command Center - each KPI card: Leads, Good Leads, Verified Sales, Spend, Cost per Lead, plus the charts and source table.
4. Sale Records - the sales cadence heat map, revenue runway, and the records table with export.
5. Lead Performance - what the speed-to-lead / response metrics mean.
6. Call Tracking - source outcome table and what "good lead" means.
7. Keywords - which search terms cost money and which produce leads.
8. Budget Pacing - monthly budget vs. spend, and what "on pace / over / under" means.
9. Reports - how to build and share a client report.
10. Assistant - asking questions in plain English.
11. Finish - "You can reopen this tour anytime from the Help button."

## Technical notes
- New table `public.user_tour_state` (user_id, tour_key, completed_at, dismissed_at) with RLS so each user reads/writes only their own row, plus grants for `authenticated` and `service_role`.
- New `TourProvider` context: holds step list, current index, running state; drives route changes via `useNavigate`.
- Steps are declared in a single data file (`src/lib/tour/steps.ts`) as `{ route, target, title, body }` so copy is easy to edit later.
- Targets are `data-tour="..."` attributes added to the existing cards/controls (Command, Sale Records, Lead Performance, Call Tracking, Keywords, Budget Pacing, Reports, Assistant, Sidebar, header controls). No logic changes to those pages, attributes only.
- Spotlight overlay component built in-house with a fixed full-screen SVG/box-shadow cutout around the target's bounding rect, positioned bubble, and Motion for React transitions. No new tour library needed.
- Auto-start logic lives in `AppShell`: if role === 'admin' and no completed/dismissed row for the current tour key, start after first render.
- Help button added to the app header, rendered only for the admin role.
