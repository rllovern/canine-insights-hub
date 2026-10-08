# Marketing Ops and Client Lifecycle: Full Build Plan (rev. 5)

You authorized the complete system in one coordinated build. Approving this plan starts it. Work runs in checkpoints; a failed checkpoint stops the build and I report back.

## Security foundation (as approved)

- Only rl.lovern@gmail.com, through an explicit grant tied to that account ID. The Super Admin role grants nothing. One active grant at a time, enforced by the database (`CREATE UNIQUE INDEX one_active_grant ON mops.access_grants ((true)) WHERE revoked_at IS NULL`).
- Private data lives in schema `mops`, which is not exposed to the browser. `PUBLIC`, `anon` and `authenticated` get no privileges on it. RLS is on with no policies.
- Browser check: `public.mops_my_access()` takes no arguments, answers only for the caller and returns no data. Every data request is checked again on the server.
- **How endpoints reach `mops`:** the service key does not give REST access to a schema that isn't exposed, and `mops` will stay unexposed. Preferred route: narrow `public.mops_api_*` functions (definer, `search_path=''`, run permission for `service_role` only), called by `mops-*` endpoints after the shared guard passes. Fallback route: a direct database connection, if the platform provides one to functions. The compatibility checks decide which route is used.
- Every `mops-*` endpoint uses one shared guard. It verifies the token, takes identity from the token only, checks the grant, and writes an audit row. Anyone who fails the check gets a 404.
- Internal exceptions are limited to an approved list: the lifecycle trigger, the questionnaire trigger and the change-history cron job. They can only write narrow records and return nothing private.
- The audit log, journal revisions and Google Ads change events are protected from updates and deletes. There is no hash chain and no digest email.
- This is privacy at the application level. Authorized infrastructure administrators keep database access.
- Emergency recovery uses `mops.recover_access`. It runs through Lovable's supported project administration, authorized from the workspace that owns this project, and is fully audited.

## Existing locations and prospects

- All 11 existing locations are classified Legacy / Active. Their questionnaire history is marked Unknown. They get no blockers, no tasks and no re-onboarding, and reporting is unaffected.
- **Finding:** existing sync jobs, the Command Center and the location list don't filter on `is_active`. Only public report links do. So prospects are kept in `mops.prospects` and are not created as locations. Converting a prospect uses the existing location-creation flow, at the point you're ready to connect it. Nothing about reporting or sync changes.

## Checkpoints

1. **Compatibility checks** (disposable `mops_probe` schema, then dropped): schema creation and revokes, default privileges, function ownership, trigger reach, a `service_role`-only RPC that is denied to signed-in users, availability of the direct-connection fallback, and a read-only look at how onboarding submissions move through their statuses. I report the results; the build stops on any failure.
2. **Foundation:** create the `mops` schema, grants, audit log and the single grant. Add the shared guard, its tests and the private menu item gated by the check.
3. **Directory and profiles:** `/ops` directory (search, filter, sort, Active vs Onboarding). Each profile has Overview, Business Discovery (questionnaire answers, read-only), Access & Assets (ownership, control, franchisee-paid billing; no passwords), Configuration, Journal and Performance (links to existing pages).
4. **Adaptive onboarding:** the questionnaire is a hard prerequisite, enforced in the database. A valid submission advances the location automatically and idempotently, and never moves it backward. Requirements are generated from the answers. Consolidated access instructions are produced per client, using the existing email service.
5. **SOPs:** the Google Ads (A–L) and CTM (A–I) areas go in as headings. Missing instruction text is flagged "Source needed" and never invented. Items are marked verified automatically only where existing data proves it.
6. **Journal and change history:** one text box and one Save button, with preserved revisions and search. A daily change archive with overlap and catch-up within Google's 30-day window, with gaps recorded. Account-wide changes are labeled as such and never assigned to a single location. Everything appears on one combined timeline.
7. **Intelligence and Brief:** rule-based Healthy / Observing / Action Required states, with minimum samples, persistence, cooldowns and auto-resolve. A Brief page.
8. **Private AI (limited):** a separate `mops-ai` summary endpoint behind the same guard, with a daily usage cap and auditing, available only on demand. It never touches Bob.
9. **Verification:** static tests, privilege tests, and denial tests for every endpoint and every role. Exception tests, regression checks on existing pages and Bob, and the database linter.

## Not changed

Bob and his tools, reporting calculations, client dashboards and reports, the Google Ads/CTM/GHL syncs, the GHL-to-CTM PHP integration, franchisee permissions, and live ad accounts.

## Still needed from you (doesn't block the build)

- Asana SOP exports, so the "Source needed" sections can be filled in word for word.
- An Asana notes export, if you want it imported into the journal.
