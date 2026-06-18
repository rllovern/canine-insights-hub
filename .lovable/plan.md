## What "New Leads" means today

The Funnel's **New Leads** count comes from the `lead_perf_pipeline` RPC:

```
COUNT(*) FROM ghl_lead_facts
WHERE property_id = <scope>
  AND lead_created_at BETWEEN _from AND _to
```

`ghl_lead_facts` is rebuilt from `ghl_contacts`, one row per contact. Its `lead_created_at` is the contact's `ghl_created_at` in GHL. So conceptually:

- **Numerator:** every GHL contact created in the window — opportunity not required, suppression tags do NOT remove it from the count (they only flag it `is_disqualified` for downstream "needs first response" logic).
- It is NOT filtered by `ad_source`, campaign label, assigned agent, or opportunity status.

So "New Leads" should equal GHL's new-contacts count for the same property + same window. For Ashtabula they do agree at the row level — there are exactly **29 contacts and 29 fact rows** with `ghl_created_at` in `[2026-06-01, 2026-06-13)`, and zero are disqualified.

## Why the dashboard shows 22 instead of 29

The 7-lead gap is exactly the leads created on **June 12**:

```
6/01: 2   6/06: 1   6/10: 4
6/02: 2   6/07: 4   6/11: 2
6/03: 1   6/08: 2   6/12: 7   ← missing from the 22
6/04: 4
              total = 29   (22 shown + 7 on 6/12)
```

All seven 6/12 leads have UTC timestamps during 6/12 daytime (11:09–20:25 UTC = 07:09–16:25 ET), so they're not a timezone-rollover edge case at the row level. They're being excluded by how the **date range upper bound** is being sent to the RPC, not by the lead definition.

Two likely causes to confirm before fixing:

1. The Lead Performance page passes `range.to` straight into the RPC via `.toISOString()`. If the picker (or a preset) is producing `to = 2026-06-12T00:00:00` instead of end-of-day, every lead on 6/12 falls outside `lead_created_at <= _to`.
2. The picker's `to` is built with `endOfDay` in the browser's local timezone. If that browser/account is on a UTC-ahead timezone, end-of-day local can still land before some 6/12 UTC events — but Ashtabula's 6/12 leads are all morning ET, so this is unlikely to be the cause here. Cause #1 is the prime suspect.

## Fixes

1. **Add a definition tooltip on "New Leads"** so this is self-documenting:

   > Contacts created in GoHighLevel during the selected window (one row per contact, by `ghl_created_at`). Opportunity not required. Suppression tags do not reduce this count.

2. **Make the RPC range inclusive of the end date.** In `src/components/lead-perf/hooks.ts`, normalize `to` to end-of-day before sending: convert the `Date` to `endOfDay(to)` (or `to + 1 day` with `<` instead of `<=` in the RPC), so leads anywhere on the selected end date are always included regardless of how the picker constructs the value. No backend change required — purely a client-side guard so the page never relies on the picker producing the right time-of-day.

3. **Reproduce + verify.** With Ashtabula selected and the picker set to 6/1–6/12, the Funnel's New Leads cell should read **29** and match GHL. If it still reads 22 after the client-side fix, the picker is sending a `to` earlier than 6/12 entirely (i.e. the user actually selected 6/1–6/11) and we'll surface the chosen end date in the page header so the discrepancy is visible.

### Out of scope for this change
- Modifying `lead_perf_pipeline` SQL, `rebuild_lead_facts`, or the suppression-tag list.
- Re-defining "New Leads" to exclude disqualified-by-tag contacts. (If you want that, it's a separate decision — it would make our number lower than GHL's by design.)
