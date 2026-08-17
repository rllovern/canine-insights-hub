# Bob's intro shows exactly once

Today the intro modal already checks the database before showing, and closing it (Got it, Try Bob, Esc, or clicking outside) writes a "seen" record. The gap is durability: that write is fired and forgotten. If it fails — offline, a flaky moment, or the tab closing right after someone clicks "Try Bob" — nothing notices, and Bob introduces himself again the next time that person logs in.

This change makes "seen" stick.

## What changes

1. **The dismissal is confirmed, not assumed.** When someone clicks Got it or Try Bob, the app waits for the save to succeed. If it fails, it retries a couple of times in the background.
2. **A local fallback.** The moment the modal is closed, the browser also remembers it locally for that account. So even if the save never reaches the server, that person does not see the intro again on that device, and the next successful session repairs the server record.
3. **Once per session, always.** The auto-open check runs a single time per signed-in session, and once the modal has been closed it can never auto-open again in that session — only the "Meet Bob" button can bring it back.
4. **Meet Bob stays manual.** Opening it from the top-bar button never resets anything; it just shows the explainer.

## Unchanged

- First-time users still meet Bob inside the guided walkthrough, and finishing or dismissing that walkthrough already counts as meeting him.
- The modal only appears for people who have already been through the walkthrough.

## Technical detail

In `src/contexts/BobIntroContext.tsx`:

- `markBobIntroSeen(userId)` returns the upsert error, retries up to 2 times with a short backoff, and always writes `bobIntroSeen:<userId>` to `localStorage` first.
- The auto-open check short-circuits on the `localStorage` key before querying, and when the key is set but the server row is missing it re-issues the upsert to heal the record.
- A `dismissedThisSession` ref blocks any further auto-open after `dismiss()`; `show()` bypasses it and does not clear it.
- `dismiss()` awaits `markBobIntroSeen` (fire-and-forget at the call site so the dialog closes instantly).

No schema, RLS, or edge-function changes — `user_tour_state` already allows each user to manage their own rows.
