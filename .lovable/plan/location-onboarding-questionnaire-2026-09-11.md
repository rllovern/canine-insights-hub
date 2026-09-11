# Location Onboarding Questionnaire

A public, link-based form that replaces the per-location Business Info spreadsheet. An owner fills it out in about 35 minutes across two sittings, staff review the answers in the admin area, download them as a PDF or data file, and choose what gets applied to the location record.

## How it works for the owner

1. Staff create an onboarding invite for a location and send it. The owner gets an email with a private link.
2. The link opens the questionnaire — 11 short screens, one topic each, 3 to 8 questions per screen, with a progress bar and remaining-time estimate.
3. Answers save automatically as they go. Closing the page loses nothing; the same link, or a fresh one emailed on request, brings them back to where they stopped.
4. Known information (location name, contracted territory, monthly budget, card on file, launch date) is shown as read-only with a confirm tick, never re-typed.
5. The last screen lists everything still missing, shows any territory conflicts, and only then allows submit.
6. On submit the owner and the team get a confirmation email with a PDF copy attached.

## How it works for staff

A new Admin - Onboarding page lists every invite with its status (not started, in progress, submitted, approved), who it is for, and when it was last touched. From a submission you can:

- Read the full answers grouped by section.
- Download a PDF summary, a CSV, or a JSON file.
- See flags raised automatically: territory overlaps with another location, a target cost per lead far below what comparable locations actually achieve, ads scheduled into hours nobody answers the phone, an existing call tracking system that will collide with ours, "Not sure" answers on any account question.
- Approve field-by-field what gets written onto the location record. Nothing updates the dashboard automatically.
- Resend the invite link.

## Sections

Start here, Location basics, Hours, Territory, Services and pricing, Trainers, Market and competitors, Existing accounts and access, Lead and call handling, Budget and targets, Review and submit. All the field-level rules from the specification are carried over, including the required minimums, character floors, forced ranking, mandatory offer expiry dates, verbatim guarantee wording, and structured phone-answerer list.

## Live lookups and integrations

These need outside services, so they are built in a second phase after the form itself works end to end:

- Address autocomplete via Google Places, storing the place ID.
- Service-area picker typing against Google's geo targeting list, storing the canonical geo target ID so a mistyped town is impossible.
- Google Ads manager-access invite fired from inside the form and its acceptance polled, using the existing Google Ads connection.
- Asana project created from a template on submit, with answers written into custom fields and dated tasks for each offer expiry.
- Google Business Profile manager invites: whether this can be automated depends on API access we have not yet confirmed. Until confirmed it is recorded as a tracked task with instructions for the owner, not an in-form action.

## Build phases

**Phase 1 - the form and the data.** Storage, invite and magic-link resume, all 11 screens, autosave, all validation, review screen, submit, admin list, detail view, PDF/CSV/JSON download, approval-based write-back to the location record. Geo and address use validated entry with canonical display but no live Google lookup yet.

**Phase 2 - live lookups.** Places autocomplete and the geo target picker replace the phase 1 inputs in place; existing submissions keep working.

**Phase 3 - outbound automation.** Asana project creation, Google Ads manager invite and polling, benchmark figures for cost per lead and per client pulled from real results across locations, GBP access if the API allows.

## Technical notes

- New tables: `onboarding_invites` (token, property, contact, status, expiry), `onboarding_submissions` (property, invite, per-section JSONB answers, completion state, submitted/approved timestamps), `onboarding_files` (trainer photos, in a private storage bucket), `onboarding_flags` (type, severity, field, detail), `onboarding_field_applications` (which answers were pushed to `properties` / `property_targets` / `property_data_sources`, by whom, when).
- No anonymous table access. The public form talks only to a `onboarding-public` edge function that takes the token, resolves the invite server-side, and reads/writes the submission with the service role. Rate-limited by token. Admin reads go through normal RLS restricted to staff.
- Magic-link resume: the token is the link; a "email me my link" action re-sends it through the existing branded `auth-email-hook` sender domain. Tokens expire and can be revoked.
- Server-side validation lives in one shared module used by both autosave and submit: Google Ads CID stripped to exactly 10 digits stored as text and rejected if already on another property, GA4 ID as text, GTM pattern, phone normalised to 10 digits, hours close-after-open unless closed, price range or explicit "Quote only", territory overlap and county-contains-city containment check across all properties.
- Trainer photos upload to a private bucket with signed-URL reads for staff only; minimum 800px width enforced client-side and re-checked on the server.
- PDF generated with the existing `jspdf` setup; CSV/JSON produced from the stored JSONB in the admin download action.
- Website admin credentials (7.14) are never stored — the field is a handoff instruction plus a recorded acknowledgement.
