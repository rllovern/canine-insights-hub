# Permanent "Test" onboarding link for walkthroughs

## What you get
- The "Test" questionnaire (contact: Test Person) becomes a permanent test link, marked with a "Test mode" banner on every page.
- On that link only:
  - **Continue** always works, so required questions never stop you.
  - You can jump straight to any page, including Step 2 (Website & brand), from a page list at the top.
  - "Submit" works even with blanks, so you can see the thank-you and Step 2 screens.
  - A **Reset test** button clears all answers so you can start fresh.
- Test answers are never sent to the team. They don't trigger review flags, territory-overlap checks or emails, and they don't show up in other locations' overlap checks.
- On the admin onboarding page, the row shows a "Test" badge.
- Every real client link works exactly as it does today, with all required questions enforced.

## Technical details
- Migration: add `is_test boolean not null default false` to `onboarding_invites`, then set it to true for invite `78307b4e-ce53-48bc-921b-d9e5de90be82` (an additive backfill).
- `onboarding-public`:
  - `load` returns `is_test`.
  - When `is_test`: `submit` skips `incompleteSections`, formatErrors, flags and email. `step2_submit` skips `step2Missing`. A new `reset` action (test invites only) clears the answers, sets the status to in_progress and current_section to 0.
  - The territory-overlap query excludes test invites for everyone.
- `Onboarding.tsx`: when `is_test`, show the banner and a page jumper (Step 1 sections, Review, Step 2), make goNext/submit bypass validation errors (still shown as hints), and add a Reset button.
- `AdminOnboarding.tsx`: show a "Test" badge.
- Tests: server-side checks that a non-test invite still rejects an incomplete submit and can't use `reset`.
