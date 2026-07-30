## Goal

On the Performance report, GHL won deals that currently land in the catch-all **Unattributed** row should count toward **Google PPC** in the Verified Sale column instead.

## Change

In `src/lib/verified-sales.ts` (`fetchWonAttribution`):
- When building the `bySource` rollup, remap any row whose `ad_source` is `Unattributed` to `Google PPC`, so its wins add to the Google PPC bucket.
- Leave the raw `rows` array untouched (Sale Records / drill-downs keep the true attribution), and keep `total` unchanged — the Grand Total still equals total won deals for the period.

In `src/pages/CallTracking.tsx` (`SourceOutcomeTable`):
- No Unattributed row will appear anymore since the bucket is empty; the existing "sources with wins but no media rows" fallback still creates a Google PPC row if the media feed has none.
- Remove the now-dead pin-to-bottom sort special-case for `UNATTRIBUTED_SOURCE`.

Both the current period and the prior-period comparison use the same hook, so deltas stay consistent.

## Note

This means Google PPC's Verified Sale count includes deals GHL could not attribute (manual CRM entries, Zapier imports, direct/organic-tagged sessions). It will read higher than strictly ad-driven sales — flagging it so the number isn't misread later.
