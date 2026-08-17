# Bob: conversational answer shape + slide-out drawer

Two changes: how Bob writes answers, and where Bob lives in the app.

## 1. Answer structure

Every Bob reply follows the same three beats:

1. Acknowledge the question in one short line ("Good question — you're seeing fewer calls in July.").
2. Give a brief answer: 2-4 plain-English sentences, the conclusion first, at most one or two numbers.
3. Close with an offer to go deeper — a specific follow-up question, not a generic one ("Want me to break that down by ad source?" / "Should I check whether last July looked the same?").

Rules layered on top:
- Keep the first pass short even when Bob ran many lookups behind the scenes. Detail comes on request.
- The closing question must be concrete and tied to what he just said; never repeat the same phrasing twice in a row.
- If a real problem is found, the brief answer still says so plainly and tells the user to alert the administration — the offer to explain further comes after that.
- No bullet dumps unless the user asks for a list.

Implemented as a rewritten "response shape" section in the system prompt of the `jarvis` edge function (Bob's backend), replacing the current free-form length guidance.

## 2. Bob becomes a drawer, not a page

- A floating circular Bob button sits in the bottom-right corner of every dashboard page (above the mobile nav, out of the way of page content). It uses the Bob mark, has an "Ask Bob" tooltip/aria-label, and hides while the drawer is open.
- Clicking it slides Bob in from the right as an overlay drawer: full height, roughly 440px wide on desktop, near full-width on mobile. Escape and a close button dismiss it; the conversation stays alive when reopened.
- The drawer keeps everything the page had: scope/date header line, Recent sessions, New session, quick-start prompts, streaming, tool cards, composer. Textarea autofocuses when the drawer opens.
- "Ask Bob" buttons on Call Tracking, Lead Performance and Reports open the drawer with the prompt prefilled and sent, instead of navigating away. Cmd+K command bar does the same.
- The sidebar/mobile-nav "Bob" entry is removed, and `/assistant` redirects to the dashboard with the drawer opened (so existing links and the tour step still work).

## Technical notes

- New `src/components/bob/BobDrawer.tsx` (shadcn `Sheet`, side right) + `src/components/bob/BobLauncher.tsx` (FAB), plus a small `BobContext` provider in `AppShell` exposing `openBob(prompt?)`.
- `BobChat.tsx` is refactored to be layout-agnostic (fills its container, no page-height `Card` wrapper) and rendered inside the drawer. Session id moves from the `?session=` URL param to provider state so it survives route changes; deep links with `?session=`/`?q=` are still honoured on load.
- `AskBobButton.tsx` and `BobCommandBar.tsx` call `openBob(prompt)` instead of `navigate("/assistant?q=…")`.
- `src/pages/Assistant.tsx` becomes a redirect; `BOB_ITEM` removed from `navItems.ts`; tour step for the assistant retargeted to the launcher button.
