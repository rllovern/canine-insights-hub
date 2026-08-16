# Rewire the assistant: Jarvis becomes Bob

Replace the report-generating "Jarvis" command agent with **Bob** — a friendly, conversational, agentic analyst who explains what the charts mean to people who know nothing about marketing, and who keeps them calm about normal dips while flagging real problems.

## What changes for the user

- The assistant is renamed Bob everywhere: sidebar, mobile nav, command bar, the /assistant page, and the "Ask Jarvis" buttons scattered across the dashboard (they become "Ask Bob").
- Bob no longer builds visual reports. No report cards, no report history panel, no saved-report viewer. He talks. If someone asks for a report, he explains the numbers in plain language and points them at the Reports page.
- Bob is still agentic: he pulls live data from every source (Google Ads spend/CTR/clicks/impressions, call tracking, lead quality, CRM deals, speed-to-lead, budget pacing, data freshness) before answering, and can chase a question across several lookups in one turn.
- Tone: warm, plain-English, no jargon, no acronyms without explaining them. Short conversational paragraphs, no bullet dumps unless asked.
- Behavior on a dip: Bob first checks whether the dip is real (compare same-length windows, last year same period, trailing 12 months, click-through rate and impression trends, budget/spend changes, seasonality of dog-training demand). If the underlying signals are healthy, he says so and explains why the drop is normal. If a signal genuinely looks broken (spend collapsed, CTR fell off, sync stale, quality rate crashed, budget exhausted), he says it plainly and tells the user to alert the administration.
- Domain expertise baked in: dog training as a business (boarding/board-and-train seasonality, holiday and summer patterns, puppy-season demand, high-ticket long consideration cycles) plus PPC/lead-gen marketing fundamentals.
- Bob never invents numbers and always names the location and date range he is talking about.

## Technical changes

**Model.** Switch `supabase/functions/jarvis/index.ts` from `openai/gpt-5.5` to the Lovable AI Gateway default `google/gemini-3-flash-preview` (fast, strong reasoning, streams over the existing chat path, no key setup). Keep the existing `streamText` + tool-loop wiring and raise `stepCountIs` so Bob can chain several lookups per answer.

**System prompt.** Full rewrite:
- Persona, tone, and audience (client who does not know marketing).
- Keep the canonical lead model (bad / good / AI-projected-sale tiers, quality rate, 30% benchmark, small-sample suppression) — that math stays non-negotiable.
- Add a "diagnose before you alarm" protocol: for any down-trend question, gather comparison windows + upstream signals (impressions, CTR, cost per click, spend pacing, call volume, quality mix, sync freshness) before characterising the change.
- Add escalation rules: what counts as a real problem, and the instruction to tell the user to contact the administration when one is found.
- Add dog-training / seasonality domain knowledge.
- Remove all report-schema, client-safe-mode, and report-type instructions.

**Tools.** Keep every read tool. Delete `save_visual_report`. Add two small read tools so Bob can reason about seasonality and health without guessing:
- `get_trend_windows` — this-month-to-date vs last-month-same-window, previous vs prior 30 days, year-to-date, last-year-same-period, trailing 12 months by month (mirrors the windows the older `ai-assistant` function already assembles).
- `get_source_health` — per-source last-sync/freshness and paused/degraded state, so Bob can distinguish "leads dropped" from "the feed stopped".

**Frontend.**
- Rename folder usage to Bob: `src/components/jarvis/*` → `src/components/bob/BobChat.tsx`, `BobCommandBar.tsx`, `AskBobButton.tsx`; update imports in `AppShell.tsx`, `Assistant.tsx`, `CallTracking.tsx`, `LeadPerformance.tsx`, `Reports.tsx`, `Sidebar.tsx`, `navItems.ts`, `tour/steps.ts`.
- Delete `src/components/jarvis/report/ReportView.tsx` and `src/lib/jarvis/reportSchema.ts`, and strip report extraction, the report history popover, and report rendering from the chat component.
- New starter prompts in Bob's empty state, phrased for a non-marketer ("Why are my leads down this month?", "Is my ad spend working?", "What do these numbers mean?").
- Keep the edge function deployed at its existing `jarvis` path (renaming the function URL would break nothing visible but adds churn); the UI label is Bob everywhere.

**Note on naming.** `bob@demo.rsk9insights.com` is an existing demo viewer account. The assistant name is display-only, so nothing conflicts technically, but the demo user may be worth renaming later to avoid confusion.
