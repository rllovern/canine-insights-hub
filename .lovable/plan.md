# DFW Form Sync (GHL to CTM): build with dry run, no live posting

Approving this plan builds the sync service, private ledger, matching logic and the private Form Sync page. Nothing is posted to CTM, no schedule is switched on, and the WordPress integration is left alone. The build ends with a DFW dry-run report for submission `6acfcd7415e56fb9d9826d9d`, then stops for your approval.

## What gets built

1. **Private sync ledger** (private Marketing Ops data, not reachable from the browser)
   - One row per GHL submission. Unique on location plus GHL submission ID. Contact ID, phone and email are never used to suppress a submission.
   - Statuses: received, matched (already in CTM), pending delivery, pending verification, delivered, failed, needs review.
   - Attempt history (append-only): every request, response summary, CTM activity ID and retry time.
   - Sync checkpoints per location: last window polled, last success, consecutive failures.
   - Per-location config: GHL location, CTM account, target FormReactor, enabled flag (off by default), field mapping.

2. **Sync service** (backend function, same shared guard pattern for manual calls, cron-secret for scheduled calls)
   - Reads GHL form submissions through the existing DFW GHL connection, with pagination and an overlapping lookback window (for example the last 2 hours every run, plus checkpoint catch-up after outages).
   - A per-location lock so two runs can't deliver the same submission at once.
   - Matching against CTM before any delivery: pulls recent CTM form activities live and scores them on GHL contact ID, form identity, submission time (tight window) and message text. Confident match: marked matched. Partial match: needs review. No match: eligible for delivery.
   - Delivery code path is written but **hard-disabled** behind a per-location flag plus a global kill switch. In this build it only produces a dry-run plan.
   - Ambiguous or timed-out responses: re-check CTM before retrying. Retries use exponential backoff. Delivery only counts once the activity is found in CTM.
   - Alerting: anything unresolved for more than 15 minutes goes to the existing data-source alert recipients (built, inactive until the schedule is on).
   - Credentials come from the existing DFW connections and stay on the backend. Messages and contact details are never logged in full, only masked.

3. **CTM FormReactor verification** (read-only, before any decision)
   - Check CTM's documented server-side FormReactor API against FormReactor 238140: can it post into that FormReactor, does it create a separate API-managed one, how custom fields (including `how_can_we_help_your_dog`) must be sent, whether any idempotency or external ID field exists, how the resulting activity ID is returned and looked up.
   - Read 238140's configuration and any triggers/AskAI workflow that apply to it, to judge whether an API-created activity would trigger AskAI. If this can't be proven read-only, it is reported as unverified and becomes part of the first live test.
   - No FormReactors are created or changed.

4. **Attribution check**
   - Read the GHL submission record for `6acfcd7415e56fb9d9826d9d` and list exactly which fields exist: GCLID, GBRAID, WBRAID, campaign/UTM values, landing page, original timestamp.
   - Check whether CTM's API accepts click IDs in a way its own Google Ads attribution and offline conversions use, as opposed to a plain custom field. GHL's session ID is not treated as a CTM visitor session.
   - Report what is preserved, what is lost, and the supported fix if something can't be carried over (for example capturing CTM's visitor ID on the page).

5. **Private Form Sync page** under Marketing Ops (same single-account grant; hidden and denied for everyone else, including other super admins and Bob)
   - Tiles: submissions received, confirmed in CTM, recovered, awaiting reconciliation, failed, last successful sync.
   - Per-location status table, plus a list of submissions with masked contact details.
   - Buttons: re-check against CTM, mark reviewed / link to an existing CTM activity, retry. Every action is audited. Retry/deliver stays disabled while the location is in dry-run.

## DFW dry-run report (end of build)

- Live confirmation from CTM itself that submission `6acfcd7415e56fb9d9826d9d` (Oct 14, PPC) is absent.
- Exact field mapping GHL to CTM, with masked name, phone and email.
- Attribution values found and how each would be sent.
- Target FormReactor and the exact request that would be made.
- FormReactor and AskAI findings, any required trigger changes, and open risks.

Then I stop and wait for your approval of the first live test.

## Not changed

WordPress integration, existing CTM/GHL/Google Ads syncs, Bob, reporting, client dashboards, existing permissions. No schedule is activated and nothing is written to CTM.

## Technical details

- Tables in `mops`: `form_sync_config`, `form_sync_submissions` (unique `(property_id, ghl_submission_id)`), `form_sync_attempts` (append-only trigger), `form_sync_checkpoints`; reached only via `mops_api` ops (`formsync_*`) through the guard.
- New function `mops-form-sync`: guard path for manual ops; scheduled path validates `get_cron_secret_v2()`. Advisory lock per property. `delivery_enabled` false plus env kill switch `FORM_SYNC_LIVE` unset means any delivery attempt returns the dry-run payload only.
- Cron job is created **disabled** (or not created) until approval.
- Tests: uniqueness/concurrency, matcher (same contact submitting twice minutes apart yields two rows), ambiguous-response reconcile, guard denials for every role, masking in logs.
