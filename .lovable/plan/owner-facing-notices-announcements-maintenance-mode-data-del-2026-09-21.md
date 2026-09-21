# Owner-Facing Notices: Announcements, Maintenance Mode, Data Delay

Confirmed before planning: `data_source_incidents` exists (created in the alerting build), alongside `alert_runbook` and `alert_recipients`. `site_announcements` and `maintenance_mode` do not exist yet.

## Feature 1 — Announcements

Two new tables exactly as specified: `site_announcements` and `announcement_dismissals`. Super admins manage announcements; every signed-in user can read active ones and can only read and write their own dismissal rows.

A new provider evaluates, on each app load, which announcements apply: active, inside the date window, and matching the audience — everyone, a listed role, or any location the user can reach. "Show once" hides after dismissal; "every login" returns each new session.

New page `/admin/announcements` (super admin only, added to the admin menu): create, edit, activate, deactivate, delete, a preview that renders exactly what an owner sees, and a dismissal count per announcement.

## Feature 2 — Maintenance mode

Single-row `maintenance_mode` table. In effect when switched on, or when now falls inside a scheduled window.

While in effect, anyone who is not a super admin or admin sees only a full-screen notice with the message and, if set, "Expected back at" in Eastern time. Nothing else renders.

- Super admins and admins always get through and see a persistent top banner with a turn-off button, so lockout is impossible.
- The franchisee questionnaire at `/onboarding/:token` is never blocked.
- Public report links at `/report/:token` are blocked with the same page.
- Previewing as another role shows the maintenance page exactly as that role sees it.

The on/off switch, message, expected-back time and scheduling live on the announcements admin page.

## Feature 3 — Automatic data delay notice

Adds `acknowledged_at`, `acknowledged_by` and `owner_notice` (auto / show / hide / maintenance) to `data_source_incidents`, plus a single-row `incident_notice_settings` table holding the auto-notice delay (default 12 hours) and the notice title and body templates with the `{source}`, `{location}` and `{since}` placeholders.

Behaviour per open incident: **auto** shows only once it has been open past the threshold and nobody has acknowledged it; **show** displays immediately; **hide** displays nothing; **maintenance** gives the full maintenance page to users whose every accessible location is affected, and the ordinary banner to users who still have unaffected locations.

Only users with access to an affected location see anything, and the text names only their own affected locations. It is a persistent amber banner at the top of every page, never a modal, and clears itself when the incident resolves.

On the Open Incidents panel (`/admin/data-sources`), each incident gains an Acknowledge button, the four-way owner-notice control, and a live preview of the exact wording owners would see. When an incident resolves, a one-click button drafts an announcement prefilled with the outage dates — opened in the editor, never auto-published.

The alert emails gain "Acknowledge" and "Control owner notice" links pointing at that panel; both require a normal login, no one-click actions from email.

## Display order

A single gate decides what may open, one modal at a time:

```text
1. Maintenance page   — blocks everything below
2. Data delay banner  — never blocks; sits alongside anything below
3. Announcements      — critical, then warning, then info, one at a time
4. First-login tour
5. Bob intro
```

When one closes, the next opens. The tour and Bob intro keep their existing internal logic; they are only told when they are allowed to open.

## Testing before reporting

Using role preview as a location owner: maintenance on (owner blocked, super admin sees banner and dashboard, questionnaire link still works); a backdated unacknowledged test incident on one location (that owner sees the banner naming only that location, an owner of another location sees nothing); acknowledge with the notice hidden (banner disappears); a critical announcement shows before the tour and the tour follows after dismissal. All test data removed afterwards.

## Technical notes

- Row-level security on all four new tables: super-admin write via the existing `is_super_admin(auth.uid())` helper; authenticated read scoped to the rows that target the reader; dismissals restricted to `auth.uid()`. Grants issued for `authenticated` and `service_role` in the same migration.
- Audience and incident scoping are evaluated client-side against the locations already loaded for the user, as agreed — these are UX controls, and the underlying data is already permitted to them.
- New providers (`NoticeProvider` covering maintenance, incidents and announcements) mount inside the app shell above the tour and Bob intro providers, plus a route-level check so `/report/:token` respects maintenance while `/onboarding/:token` never does.
- Nothing in jarvis, ai-assistant, the `ai_agent_*` tables, the `agent_*` tables, or Bob's internals is modified.
