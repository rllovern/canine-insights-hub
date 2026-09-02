# Connection audit: what is actually broken

I checked every location and every source against the sync history. Here is the real state.

## Verified state (Sep 2)

**Google Ads — healthy except one location.** 9 of 10 locations synced within the last 5 hours. **RK9 Summerville - SC** last synced Sep 1 at 17:16 — 26 hours ago. That is the "Stale" badge. Its connection is fine (connected, account configured); it is simply not being reached.

**Call tracking (CTM) — fully healthy.** All 9 connected locations synced within the last 4 hours, zero failures.

**GoHighLevel — one poison-pill location plus one dead connection.**
- **NorCal** is the "Retrying" state. In the last 24 hours it produced **575 identical failures**, all from one deleted contact: GHL answers `400 Contact not found` for contact `otnNtyVFyzN887whJMcl`, which still exists in our mirror. The message step fails, the whole GHL pair is marked failed, and the 2-minute recovery job retries it forever.
- **DFW (37), Central IL (6), Winchester (1)** hit a second message-step bug: `ON CONFLICT DO UPDATE cannot affect row a second time` — GHL returns the same message twice in one page and the batched write rejects the whole batch.
- **MoCo** has no private integration token saved (251 consecutive failures). It is genuinely disconnected, not broken code.
- Everything else (Ashtabula, Central IL, DFW, Ohio, Colorado Springs, NoVA, Winchester) has successful GHL runs within the last few hours.

**Analytics / Rankings** are not configured on any location, which is why they read "Off".

## Why one bad contact makes another location stale

The recovery watchdog runs every 2 minutes and, by design, works **one pair per tick**. NorCal's GHL pair is permanently eligible (its last run is always a failure), so it wins the slot on essentially every tick. Nothing else gets recovered — which is exactly why Summerville's Google Ads has sat stale for 26 hours instead of self-healing.

So there is one root cause chain: an unrecoverable per-record error is treated as a whole-source failure, that failure retries forever, and the forever-retry starves the recovery queue.

## The fix

**1. Stop treating per-record errors as source failures.**
In the messages step, a `Contact not found` / `CONVERSATIONS_CONTACT_NOT_FOUND` response means the contact was deleted or merged in GHL. Skip that contact, mark it retired in our mirror so it is never fetched again, and let the step finish successfully. Record a count of skipped contacts in the run stats so it stays visible.

**2. Fix the duplicate-message write.**
De-duplicate each batch by message id before writing, so a page containing the same message twice no longer rejects the entire batch (DFW, Central IL, Winchester).

**3. Cap the retry loop per pair.**
A pair that fails the same way N times in a row moves to a slower schedule and cannot occupy more than one recovery slot per cycle. Repeated identical errors escalate to "Action needed" instead of retrying indefinitely.

**4. Make the recovery watchdog fair.**
Rotate the per-tick slot by oldest-attempt-first across all eligible pairs, so a permanently failing pair can never monopolise recovery. Summerville-style staleness then heals within minutes.

**5. Pause MoCo's GHL properly.**
"No token saved" is a configuration failure, not a transient one — set the pair to paused with a clear "Reconnect required" state so it stops burning retries and shows as Action needed rather than blocked.

**6. Immediate recovery after the fixes ship.**
Force a Google Ads sync for Summerville and a full GHL sync for NorCal, then confirm every pair reports a success within the last cycle.

## Technical notes

- `supabase/functions/sync-ghl/index.ts`: `conversations_messages` phase — treat GHL 400 `CONVERSATIONS_CONTACT_NOT_FOUND` as a per-contact skip (flag contact as retired), and de-duplicate rows by message id before the `ghl_messages` upsert.
- `supabase/functions/resync-failed/index.ts`: order candidates by oldest `last_attempt_at` rather than first-match; add a per-pair cooldown after repeated identical errors; extend `HARD_FAILURE_PATTERNS` / pause handling to cover "no token saved".
- `scheduled-sync-all`: start each cycle from the location with the oldest successful run so the tail of the list (Summerville) is not consistently starved.
- Health surfaces (`ApiHealth.tsx`, `SourceHealthPanel.tsx`) gain an "Action needed" state distinct from "Retrying" so a paused connection never reads as an in-progress retry.

## Verification

After deploy: NorCal GHL produces a successful `conversations_messages` run with a non-zero skipped-contact count; DFW/Central IL/Winchester message batches write without conflict errors; Summerville Google Ads shows a success under 4 hours old; MoCo reads "Reconnect required"; the 2-minute job's failure volume drops from ~600/day to near zero.
