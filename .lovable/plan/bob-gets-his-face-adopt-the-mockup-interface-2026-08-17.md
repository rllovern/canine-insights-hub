# Bob gets his face: adopt the mockup interface

Rebuild Bob's launcher and drawer to match the uploaded one-page mockup, while keeping the real backend (live data tools, streaming, scope/date awareness, session history).

## What Bob looks like

- **The character.** Bob becomes an animated blue blob face rendered in code (no image file): gradient sphere, glossy highlight, two eyes with moving irises and blinking lids, expressive eyebrows, and a mouth that changes shape. He bobs gently up and down with a soft shadow underneath.
- **Moods.** happy, soft (resting), thinking, curious, concerned, sleepy, yawn — each with its own eyes, brows, mouth and head tilt.
- **Idle life.** When nobody is talking to him, Bob randomly glances left/right/up, blinks, yawns, gets sleepy, then settles back to his resting face.
- **Closed state.** Bottom-right: the large Bob character as the button, plus a white pill next to him reading "Ask Bob about your numbers" that fades in shortly after page load. Both hide when the drawer is open.
- **Open state.** A floating rounded card (384px wide, up to 640px tall, right/bottom 24px) with frosted-glass white background, soft shadow, and a small Bob peeking out above the top-left corner of the card. When he's working, little thought bubbles float up from his head.
- **Header.** "Bob" plus a status line that changes with his mood ("Happy to help", "Thinking…", "Good question!", …), and a round grey ✕ close button.
- **Messages.** iMessage-style bubbles: blue on the right for the user, light grey on the left for Bob, with a small pop-in animation and a three-dot typing bubble while he's thinking.
- **Quick chips.** A row of small blue pill buttons above the input for starter questions.
- **Composer.** A single rounded input with a round blue ↑ send button.

## What stays real

- Same edge function, streaming, tools, location-selector scope, date range, and the acknowledge → brief answer → follow-up answer shape. The mockup's canned replies are not used.
- Recent sessions and "New session" stay, moved into a compact icon row in the header so the card stays clean.
- Tool activity still renders inside Bob's messages, but as a slim collapsed line so it doesn't break the bubble look.
- Mood is driven by real state: thinking while streaming, curious/happy after a normal answer, concerned when Bob's reply flags a problem or an error occurs, sleepy/yawn while idle.
- Mobile: the card goes near full-width with side margins; the launcher sits above the mobile nav.

## Technical notes

- New `src/components/bob/BobFace.tsx` — the character, props `scale`, `mood`, `gaze`, `lid`, `color`; pure CSS/SVG, ported from the mockup's `buildBob` with the same geometry, gradients and keyframes.
- New `src/components/bob/useBobMood.ts` — blink timer, idle behaviour scheduler, and `setMood`, cleaned up on unmount and paused while streaming.
- Keyframes (`bobBounce`, `drawerIn`, `msgIn`, `dotPulse`, `thoughtFloat`, `pillIn`) added to `src/index.css`; the mockup's inline hex colors mapped onto existing design tokens so dark mode still works, with Bob's own blue kept as a dedicated token.
- `BobLauncher.tsx` rewritten to render `BobFace` + the greeting pill instead of the current image FAB; keeps `data-tour="bob-launcher"`.
- `BobDrawer.tsx` replaced: drop the shadcn `Sheet` for a fixed positioned floating card with the entry animation, Escape-to-close and focus handling kept.
- `BobChat.tsx` restyled to the bubble layout: keep `useChat`, transport, session restore, pending-prompt auto-send and interrupted-tool detection untouched; swap the AI Elements `Message`/`MessageContent` presentation for the bubble styles, the empty state for Bob's greeting message, and the quick prompts for chips. Composer keeps `PromptInput` with the round send button styling.
