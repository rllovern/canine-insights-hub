## Root cause

The "Pending" badge is the UI state `input-streaming` from `src/components/ai-elements/tool.tsx` (label map: `"input-streaming": "Pending"`). It means the model started a tool call but the tool never returned an output — the stream was cut off mid-execution.

The edge logs prove it:

```
[Jarvis Tool Context] toolName: "reconcile_ctm_to_ghl" ...
CPU Time exceeded
shutdown
```

`reconcile_ctm_to_ghl` in `supabase/functions/jarvis/index.ts` runs into the Supabase Edge Runtime CPU budget and the worker is killed before it can return. Because the tool never produces output, `save_visual_report` is never called either, and the AI SDK stream ends with the last tool part still in `input-streaming` / `input-available`. The UI therefore renders "Pending" (or "Running") forever.

Why it's blowing the CPU budget:

- `ghl_contacts` is fetched with `.limit(50000)` and NO date filter — full property contact dump.
- `ghl_lead_facts` and `ghl_opportunities` are fetched with `.limit(50000)` each.
- `ghl_messages` is fetched with `.limit(100000)`.
- All of this is then walked in nested JS loops with `new Date(...).getTime()` per row.

For a property like Ashtabula this trivially exceeds the per-invocation CPU budget. It is not a bug in the report renderer or in property context — those are working (logs show `inputPropertyId: ea92c5ce-...` resolved correctly).

## Plan

### 1. Make `reconcile_ctm_to_ghl` finish inside the CPU budget

In `supabase/functions/jarvis/index.ts`:

- Restrict `ghl_contacts` to phone/email values that actually appear in the window's CTM calls instead of pulling the whole property:
  1. Fetch CTM calls first (already capped at 2000).
  2. Build the set of normalized phones and emails from those calls.
  3. Query `ghl_contacts` with `.or("phone.in.(...),email.in.(...)")` in chunks (≤ ~200 values per `.in`).
- Lower hard caps: `ghl_lead_facts` and `ghl_opportunities` → `.limit(5000)` (window-scoped), `ghl_messages` → `.limit(20000)`.
- Reduce default `days` from `10` to `7`; keep `max(90)` but warn via caveats when the window is large.
- Precompute `callTs` and `callDay` per call once; precompute `msgTs` / `msgDay` per message once into a typed array so the inner loop is O(1) per candidate instead of re-parsing dates.
- Short-circuit per-call ranking: as soon as a candidate scores `opportunity`, stop iterating remaining candidates.
- Add a soft time guard: capture `performance.now()` at the start; if processing exceeds ~8s, stop classifying further calls and add a caveat `"Partial result: stopped after N calls due to time budget"` so the tool always returns and `save_visual_report` can run.

### 2. Make stuck tool calls visible instead of permanently "Pending"

In `src/components/jarvis/JarvisChat.tsx` (and the AI SDK chat status handling there):

- When the chat status transitions to `error` or the stream ends with any tool part still in `input-streaming` / `input-available`, render that tool part as `output-error` locally with the message: "Tool run was interrupted (likely exceeded compute budget). Try a narrower window."
- Surface a single non-blocking toast: "Reconciliation didn't finish — try `days: 7` or a single source."

No change to `tool.tsx` label map; we just stop leaving parts in the streaming state on stream termination.

### 3. Verification

- Redeploy `jarvis` edge function.
- From `/assistant` with Ashtabula selected, ask: "Run the CTM↔GHL reconciliation for the last 7 days."
- Confirm in edge logs: `reconcile_ctm_to_ghl` completes with a result object, `save_visual_report` is then called, no `CPU Time exceeded`.
- Confirm in UI: tool badges progress Pending → Running → Completed, and the report renders via `ReportView`.
- Force a timeout case (e.g. `days: 90` on a large property) and confirm the UI shows an error badge + toast instead of an indefinite "Pending".

### Out of scope

- Auth path (verified working: `hasUser: true`, token valid for 1503s).
- Property context plumbing (verified working: `inputPropertyId` matches selection).
- Report renderer crash safety (already handled by `ReportErrorBoundary`).
