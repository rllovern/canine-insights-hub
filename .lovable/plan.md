# Agency-wide Lead Reconciliation (permanent capability)

## Starting point
- DFW is live: 5-minute schedule, a private record of every lead, 15-minute wait for WordPress, a duplicate check before sending, verification after sending, AskAI tag checks, and alerts.
- 10 active locations are connected to both GHL and CTM: Ashtabula, Central IL, DFW, Indy, MoCo (its GHL connection is paused), NorCal, Ohio, Colorado Springs, NoVA, Winchester.
- DFW's configuration, history, records and schedule stay as they are. DFW becomes the first entry in the new system.

## What gets built

### 1. Automatic location checks (preflight), repeated daily and on demand
For each location connected to both GHL and CTM, the system checks and records each item as pass or fail:
1. GHL token works and the GHL location ID matches the one saved in the dashboard.
2. GHL forms can be listed and submissions can be read, across every page of results.
3. The CTM account matches the one saved for that location, and its login can read activities and the activity list.
4. The location's own CTM FormReactor(s) are found through the CTM API. **The FormReactor must belong to that location's CTM account.** Locations never share DFW's account, login or FormReactor.
5. Each customer-inquiry form maps to exactly one FormReactor and one message field. If a location has several FormReactors and the right one isn't clear, the location is held.
6. Duplicate protection works: the location's recent CTM form activities can be matched to its GHL submissions (by submission ID, contact, message or time). If WordPress-delivered leads can't be matched back to GHL reliably, the location is held. Without that check, sending could create duplicates.
7. Conversion check (read-only): the location's CTM triggers are listed and recorded for visibility. Nothing is changed.

If every check passes, the location turns on automatically. Its start time is set to the moment it passed, so older submissions are never sent. If a check fails, the location stays off, shows the exact missing item, and sends an alert. A newly onboarded location is picked up by the next daily check, with no manual switch.

### 2. Form discovery and classification
- All GHL forms at each location are listed and sorted into **Customer inquiry**, **Operational/admin** (vaccine uploads, waivers, internal forms) or **Unclassified**.
- Sorting uses the form name and fields, such as message, dog or training questions, and phone/email. Forms that can't be sorted with confidence stay **Unclassified**. They are watched and reported, but never sent to CTM until you classify them in Marketing Ops.
- Message and custom-field keys are detected per form, so each location can use different field names.
- Each customer-inquiry form keeps its source label (ppc, website, yelp, boarding, and so on). This comes from the form name or campaign data. If neither is clear, the source is "website".

### 3. Recovery (same engine, all locations)
- Existing DFW rules apply everywhere: 15-minute WordPress grace, a fresh CTM check right before sending, matching by submission ID first, separate records for separate submissions from the same contact, review holds for unclear matches, a send-once lock, verification by activity ID before **Delivered**, retries with backoff, and catch-up for up to 30 days after outages.
- Every send keeps the name, email, phone, message, source, GHL IDs, original time, and GCLID/GBRAID/WBRAID/UTM data as CTM custom fields. No CTM visitor ID is ever created.
- The global live switch stays as the master off switch. Each location's own switch is set by the preflight checks.

### 4. Call and lead discrepancy monitoring (monitor and alert only)
- CTM inbound calls are compared with GHL contacts and conversations by phone number, within a time window, for each location.
- A missing call is flagged only where that location's setup shows CTM calls normally reach GHL. The system learns this from the location's own recent history (share of calls that matched). Locations where calls don't usually reach GHL are reported as "not expected".
- Also flagged: duplicate or unclear records, CTM activities without a tag past the review window, and stale or failing connections.
- Nothing is ever created, changed or overwritten in CTM or GHL by this part.

### 5. Qualification
- CTM stays the authority for lead tags. The seven existing tags are reported as they are, and no new tags are created.
- A lead without a tag is shown as **Needs Qualification**, never as a Good Lead.
- Conversion triggers aren't changed.

### 6. Lead Integrity dashboard (Marketing Ops → Lead Reconciliation)
- Agency overview cards: GHL submissions, confirmed in CTM, missing, recovered, duplicates prevented, awaiting review, call discrepancies, awaiting qualification, failures, and last successful check per location.
- Filters: location, date range, source, discrepancy type.
- Location table with check status (On, Held + reason, Paused) and a "Run checks now" action.
- Location drill-down: the check checklist, form list with classification controls, lead records, sync history and attempts.
- The current Form Sync page becomes this page, and its old link redirects there.
- Access stays exactly as now: only your Marketing Ops access. Other super admins, client users and Bob are excluded.

### 7. Alerts (to existing Marketing Ops alert recipients)
Alerts go out for: a lead unconfirmed after more than 30 minutes, a failed recovery, a failing API connection, the schedule stopping (no successful run for 20 minutes), a lead without a tag past the review window, a match needing review, and a location failing its checks.
Repeat alerts for the same item are suppressed until its state changes.

### 8. Google Ads
Each record shows "Click ID stored as CTM custom field" separately from "Native CTM Google Ads attribution: not verified". No upload process is added, and conversion rules aren't changed.

## Rollout order
1. Build the checks, form discovery, dashboard and monitoring. DFW is untouched.
2. Run the checks on all 10 locations as a read-only check (no sending), and review each location's detected forms, FormReactor and matching rate.
3. Locations that pass turn on, with each start time set to that moment. Failing locations stay off and are listed with their reasons.
4. Confirm the 5-minute schedule completes for all active locations, then report the 7 items you asked for.

## Known risks (reported, not guessed)
- Some locations may have more than one CTM FormReactor, or none. Those stay held until a reliable mapping exists.
- MoCo's GHL connection is paused by design, so MoCo will be held.
- Call matching depends on how phone numbers flow into GHL for each location. Where that can't be established, the call check runs as "monitor only, not expected".
- Native CTM Google Ads attribution for recovered leads remains unverified.

## Technical details
- Private tables (all in the existing private Marketing Ops area, reachable only through the existing guarded endpoint):
  - Location check runs and per-check results
  - Discovered forms with classification and field keys
  - Call discrepancy records
  - Alert-suppression state
- Existing form_sync config, records, attempts and checkpoints are extended (new columns only). DFW's row is preserved, and its form_map seeds the form list.
- `mops-form-sync` gains preflight, form-discovery and call-reconciliation modules beside the injectable `engine.ts`. The scheduled path reads its locations from preflight status instead of the manual flag. A daily preflight runs inside the existing 5-minute job when it is due, so no second polling job is added.
- CTM FormReactor discovery uses CTM's form-reactor listing for each location's own account and credentials. GHL forms use `/forms` and `/forms/submissions`.
- New scenario tests cover: preflight pass/fail combinations, no cross-account FormReactor use, unclassified forms never sent, activation start time respected, call monitor making no writes, and alert suppression.
- Only the Marketing Ops pages change. Bob, client dashboards, reports, other syncs, WordPress and GHL-to-CTM PHP stay untouched.
