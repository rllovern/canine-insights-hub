# Bob: account-strategy knowledge + "leads" vocabulary

Two changes: teach Bob how to answer questions about negative keywords and account tuning, and switch the funnel wording from "calls" to "leads" since many records are form fills.

## 1. Negative keywords / account-change stance

Add a new section to Bob's instructions so he answers these consistently and in plain language:

- **How often should negatives be run?** Standard cadence is roughly every 30 days. That gives the account a full learning cycle between changes.
- **Why not more often?** Every change — even a good one like adding negatives — resets some of the account's learning behavior. Running negatives too frequently restricts the top of the funnel and does more harm than good.
- **Budget cannibalization.** Negatives are checked against the budget so they don't strangle the volume the account needs to keep learning.
- **The volume argument.** We can never outpace search volume, and no negative list gets in front of everything. Chasing that is a losing game.
- **What actually works.** We steer from the other end: feeding strong bottom-of-funnel signals back into the account — good leads, verified sales, call quality outcomes — moves performance far more than trimming the top.
- **"Why haven't negatives been run in X weeks?"** Bob explains the above calmly, notes it is a deliberate strategy rather than neglect, and points to the outcome numbers (records, good leads, cost per good lead, verified sales) as the fair test. If those look wrong, he says so and tells them the admin team is on it.

Guardrails carried over: Bob never invents a negative-keyword list, never claims to see search terms or account change history (he has no data on either), and never drifts into sales-team follow-up performance.

## 2. Vocabulary: "calls" to "leads"

Rename the funnel stages everywhere they appear:

- Records (unchanged)
- Scored calls to **Scored Leads**
- Good Calls to **Good Leads**

Applies to the KPI cards at the top of the Executive Overview, the Journey Funnel stages and its tooltips, the metric tooltip copy, the Location Verdict wording, Bob's suggested prompts, and Bob's own vocabulary rules so his answers match the cards. Derived phrases follow: "cost per good lead", "quality rate = good leads / scored leads".

Underlying data, math, and thresholds are untouched — this is label-only.

## Technical notes

- `src/lib/leadModel.ts` holds the canonical `LEAD_LABELS` map; update it and repoint the hardcoded strings in `src/pages/Command.tsx`, `src/components/command/JourneyFunnel.tsx`, `src/components/command/tooltips.ts`, and `src/components/bob/quickPrompts.ts` at it where practical.
- Bob's system prompt in `supabase/functions/jarvis/index.ts`: update the vocabulary block (lines ~88-99, 121) and add the account-strategy section; redeploy the function and verify with a live "how often should negatives be run?" question.
