# Fix Bob: bubble rendering + number reconciliation

Two problems, one plan.

## 1. Rendering — text escaping its bubble, everything in one blob

In the screenshots, Bob's long answer paints an empty rounded bubble with the text sitting outside it, and the acknowledgement line and the explanation share one message instead of arriving as two bubbles.

Cause: the shared `MessageResponse` markdown renderer carries `size-full` (`height: 100%`), which collapses/overflows inside Bob's fixed-width bubble. Bob also renders one bubble per message, so multi-paragraph answers are one block.

Fix in `src/components/bob/BobChat.tsx`:
- Render Bob's text with a local renderer that does not force full height (no `size-full`), with `whitespace-pre-wrap`, `break-words`, and `overflow-wrap: anywhere` so nothing can spill past the bubble.
- Split each assistant message's text on blank lines and render **one bubble per paragraph**, stacked with a small gap and the tail corner only on the last one — so the "I'm looking into…" beat and the explanation are separate bubbles, exactly like the mockup.
- Keep user messages as a single bubble.
- Cap bubble width and let long numbers/URLs wrap.

## 2. Numbers — Bob is not reading what the cards read

Verified against the database for RidgesideK9 NoVA, Aug 1–16:

| Metric | Cards | Bob's source |
| --- | --- | --- |
| Good leads (Qualified Calls) | 25 | 60 |

The cards' `fetchWindow` excludes the `GHL Won` disposition feed and, for shared Google Ads accounts, only counts campaigns labelled to that location (NoVA has 3 labelled campaigns). Bob's `ai_assistant_context` RPC sums `daily_metrics` raw — every source, every campaign — so it reports 60/61 where the card shows 25. It also takes Records from `daily_metrics.record_count` instead of `v_lead_counts_daily.records`.

Fix:
- Rewrite the `ai_assistant_context` function so it applies the exact same rules as the dashboard: drop `GHL Won`, apply the `campaign_labels` allow-list to Google PPC rows when a location has labels, take Records from `v_lead_counts_daily`, and return the canonical model (`good`, `projected`, `bad`, `total_leads = good + projected + bad`, `quality_rate = (good + projected) / total_leads`) plus a source breakdown built under the same filters.
- Add a multi-location variant so all-locations questions roll up with the same rules.
- Point Bob's other lookups at the same filtered math: `compare_periods`, `get_account_stability`, and any other read of `v_lead_counts_daily` / `daily_metrics` in the `jarvis` function get the label allow-list and `GHL Won` exclusion applied.
- Make Bob use the selector's window verbatim (no shifting to "first half of August"), and name the window the way the cards label it.
- Update Bob's system prompt so his vocabulary matches the cards: "Records", "Qualified Calls" (= good leads), "Qualified Leads" (= good + AI-projected-sale calls), "Verified Sale".

## Verification
- Re-query NoVA Aug 1–16 through the rewritten function and confirm it returns good 25, projected 5, bad 15, records 88, quality 66.7% — matching the cards in the screenshot.
- Ask Bob "Why are my leads down?" on NoVA and confirm the numbers he quotes equal the KPI cards, and that his answer arrives as separate, properly-enclosed bubbles.

## Technical notes
- Files: `src/components/bob/BobChat.tsx`, `supabase/functions/jarvis/index.ts`, plus a migration replacing `public.ai_assistant_context` and adding the portfolio variant (security definer, access-checked).
- No change to the dashboard's own math — the cards stay the source of truth and Bob is moved onto it.
