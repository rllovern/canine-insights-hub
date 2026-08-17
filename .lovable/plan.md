# Fix Bob’s missing responses and chat latency

## Confirmed failure

Bob’s backend request is completing successfully, but the frontend changes the AI SDK chat ID as soon as the new backend session ID arrives in the response headers. The installed AI SDK recreates its internal chat instance whenever that ID changes. This happens while the response is still streaming, so the final assistant message lands in the old instance and never reaches the chat window.

A second race then makes the symptom persistent: session-history restoration can query the newly created session before the assistant message is saved, overwrite the live messages with partial history, and mark that session as already restored.

## Implementation

1. **Separate the live chat instance from the saved session ID**
   - Give each mounted conversation a stable client chat key that does not change during a request.
   - Continue capturing the backend session ID from the response header for persistence and future turns, but never use that header update to replace the active AI SDK chat instance.
   - Change the client chat key only for explicit user actions: New conversation or selecting a conversation from History.

2. **Make history restoration race-safe**
   - Do not run history restoration for a session created by the currently active stream.
   - Restore only after an explicit history selection or initial load of an existing saved session.
   - Prevent a late history query from overwriting messages that arrived while it was in flight.

3. **Harden completion and error states**
   - Clear stale errors when a new turn begins.
   - Keep the single “Thinking…” state requested by the user and remove it immediately on success or failure.
   - Preserve the retry fallback only for a genuinely completed/interrupted turn with no assistant text; do not misclassify an in-flight or session-switched turn.
   - Keep the composer focused and immediately show the optimistic user message.

4. **Reduce avoidable request overhead without changing Bob’s behavior**
   - Keep the consolidated diagnosis tools and short tool ceiling.
   - Remove redundant frontend session work from the streaming path so the first text and final response render without a state reset.

## Verification

- Reproduce with the “Why are my leads down?” quick prompt.
- Verify the user bubble appears immediately, only “Thinking…” is shown during work, and Bob’s text renders in the same open window when the backend returns the session header.
- Verify status returns to ready and no frontend error remains.
- Send a second message in the same conversation and confirm both turns remain visible.
- Create a new conversation, switch through History, and reload an existing session to confirm messages neither disappear nor bleed between sessions.
- Check browser console/network output and confirm the successful backend response corresponds to a rendered assistant message.