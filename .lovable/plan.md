# Fix the confusing "0 Sales" in the Location Verdict mix

## What's happening

Two different things are both being called "sales" on the same card:

- **"Mix: 10 bad · 8 good · 0 Sales"** counts the CTM call-scoring tier (`projected_sale`) — calls the AI scored as a likely sale at the time of the call. Colorado Springs has 0 of those in this window.
- **"6 verified sales"** on the line below counts actual closed/won deals from the CRM.

So the numbers aren't wrong, but the label is. The same word means two different things one line apart, which is why it reads as a contradiction.

## The fix

1. Rename the third mix tier so it can never be read as closed deals. The mix line becomes:
   `Mix: 10 bad · 8 good · 0 projected-sale calls.`
2. Keep "verified sales" as the only place the word *sales* means closed deals.
3. Add a short tooltip note on the Location Verdict info icon explaining that the mix is call-quality tiers from call scoring, while verified sales come from the CRM.
4. No change to any math: quality rate, grading thresholds (30% / 25%), Wilson interval, and portfolio benchmark all stay exactly as they are.

## Technical notes

- `PROJECTED_LABEL` in `src/lib/leadModel.ts` is currently `"Sales"`; change it to `"projected-sale calls"` (shortened to "projected" where space is tight). This label is used in several surfaces, so each usage site gets checked so the wording still reads correctly in context.
- Mix string is built in `locationVerdict()` in `src/components/command/PortfolioVerdict.tsx`.
- The context line (`{n} leads · {qualified} qualified calls · {sales} verified sales`) is unchanged.
