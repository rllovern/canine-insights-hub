# Bob keeps "thinking" after he has already answered

## What's actually happening

This is a backend deadlock, not a UI bug. The chat window only stops the dots and the "Thinking…" line when the response stream closes. Right now the stream can't close until a 90-second timeout expires:

- Bob's answer is passed through a safety gate that watches the whole stream and only announces its verdict once the stream has finished.
- The save-the-answer step waits for that verdict before it lets the stream finish.

So each waits on the other. The text has already rendered, but the connection stays open until the 90s escape hatch fires — which is the stretch where Bob looks like he is still thinking.

## The fix

1. Stop the save step from blocking the stream. Capture the drafted answer when the model finishes, let the stream close immediately, and write the message row once the gate reports its verdict (in the background, after the response has ended).
2. Keep every existing safety behaviour unchanged: the numeric gate, the forced-retry replacement, and the "unbacked numeric answer" logging still decide what gets persisted — they just no longer hold the connection open.
3. Add a client-side backstop so a wedged connection can never leave the UI spinning forever: if no new tokens arrive for a set idle period after the answer is complete, the chat drops back to the ready state instead of showing dots indefinitely.

## Technical notes

- `supabase/functions/jarvis/index.ts`: remove the `await Promise.race([gateVerdict, 90s])` from `toUIMessageStreamResponse`'s `onFinish`. Instead store `responseMessage.parts` / `toolRuns` in a closure, and attach the persistence work to `gateVerdict.then(...)` (kept alive via `EdgeRuntime.waitUntil`) so the insert still records the replacement text when the gate substitutes an answer.
- `src/components/bob/BobChat.tsx`: idle-watchdog that clears the loading indicator (`isLoading`-driven dots and header status) if the stream produces no new parts for a few seconds after the last text part completes.
- No prompt, tool, schema, or metric changes.
