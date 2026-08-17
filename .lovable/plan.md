# Introducing Bob

Every user who signs in should learn who Bob is — once. How they learn it depends on whether they are brand new.

## Behaviour

- **Returning user** (has already completed or dismissed the dashboard walkthrough): a one-time "Introducing Bob" modal appears shortly after landing on the dashboard. Explains who Bob is, what he can answer, and how to open him. Buttons: "Try Bob" (closes the modal and opens the Bob drawer) and "Got it". Either way it never shows again.
- **First-time user** (walkthrough has never run): no separate modal. Instead the guided walkthrough gains a dedicated Bob step, and finishing or dismissing the walkthrough also marks the Bob intro as seen, so the modal never fires afterwards.
- Suppressed on `/login`, `/reset-password`, `/change-password` and while the walkthrough is running.
- The modal can be re-opened any time from the Help menu area, so no one is locked out of the explainer.

## What the modal says

- Title: Meet Bob, your marketing assistant.
- Bob's animated face, plus 2-3 plain-English lines: ask questions in normal words, he reads your real dashboard numbers, and he follows the location and date range you have selected at the top.
- Three example questions the user can click to launch Bob pre-filled (drawn from the existing quick prompts, location-aware).
- One honest limit line: Bob answers on leads, ads and verified sales — anything else, ask the admin team.

## Technical notes

- Reuse the existing `user_tour_state` table with a new `tour_key` of `bob-intro-v1` (no migration needed): `completed_at` / `dismissed_at` mark it seen.
- New `BobIntroDialog` component in `src/components/bob/`, mounted in `AppShell` alongside the Bob drawer.
- New small hook/state in `TourContext` (or a sibling `useBobIntro` hook) that on load reads both `dashboard-v1` and `bob-intro-v1` rows in one query:
  - `bob-intro-v1` seen -> nothing.
  - `dashboard-v1` never seen -> let the walkthrough run, no modal; on walkthrough completion/dismiss also upsert `bob-intro-v1`.
  - otherwise -> show the modal.
- Add a Bob step to `src/lib/tour/steps.ts` for all tour roles (the existing `assistant` step is staff-only) that spotlights `[data-tour="bob-launcher"]` with the same plain-English copy as the modal.
- "Try Bob" calls the existing Bob context `open()`; example-question clicks open the drawer and submit the prompt.
