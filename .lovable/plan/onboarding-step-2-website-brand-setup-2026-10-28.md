# Onboarding Step 2: Website & Brand Setup

## What the client sees
- **Step 1 (unchanged 10 sections)**, plus two small upgrades:
  - Programs: optional "Price breakdown / add-ons" box under each program (e.g. 3-week board and train $3,650 / extra week $900 / follow-up lesson $150).
  - Travel distance: "How far will you travel for an in-home session? ___ miles".
- After Step 1 is submitted: a "Step 1 complete" screen leading straight into **Step 2: Website & Brand Setup** (same link, same auto-save, no new password).
- **Step 2** asks:
  1. Where do you train dogs? (pick all that apply) In my home / At a training facility / In the client's home / Out in public places
  2. Pick your logo: Standard or Custom (picture above each)
  3. Pick your website colors: Deep Moss / Midnight Steel / Ember / Custom (picture above each)
  4. Optional notes for the web team
- If Custom is chosen for the logo or colors, a "Book a design call" button appears right below, linking to your colleague's calendar.
- Logo and colors are required to finish Step 2. Step 1 still counts as complete on its own, so ad setup is never held up.

## Images
- Pull the 6 pictures (2 logos, 4 color cards) from the shared Drive folder through your Google Drive connection, and store them with the app so they keep loading even if Drive sharing changes.
- If the folder contains files that don't clearly map to those 6 choices, I'll stop and list them rather than guess.

## Admin side
- New answers show in the onboarding review, PDF and CSV/JSON exports, with a "Step 2: complete / not started" badge per client.
- The existing questionnaire gate for onboarding tasks stays tied to Step 1 only. Old submissions are untouched and show Step 2 as "Not started", never as complete.

## Needs from you
- Your colleague's booking link (Google Calendar appointment page or Calendly). Until provided, the button reads "We'll reach out to schedule a design call" instead of a fake link.

## Unchanged
Bob, reports, syncs, Lead Reconciliation, GHL-to-CTM and Marketing Ops access.

## Technical details
- `src/lib/onboarding/schema.ts`: `price_breakdown` textarea on `programs`; miles suffix on `travel_radius_miles`; new `website_branding` section flagged `step: 2` with `training_locations` (multi), `logo_choice`, `color_palette` (new `visual_radio` type with image + value), `brand_notes`. `missingRequired` scoped by step.
- `src/components/onboarding/FieldInput.tsx`: `visual_radio` card grid; booking callout via `showIf` on custom.
- `src/pages/Onboarding.tsx`: step state from submission status; Step 1 submit -> transition screen -> Step 2.
- `supabase/functions/onboarding-public/{validate.ts,index.ts}`: mirror new fields; accept a `step2_submit` action that records `step2_completed_at` in answers metadata (no schema change unless the submissions table lacks a JSON slot — verified at build time).
- Images: Drive connector (link if not yet linked) -> `/tmp` -> `lovable-assets` pointers in `src/assets/onboarding/branding/`.
- Update schema tests for step-scoped required rules; `AGENTS.md` rule for two-step onboarding.
