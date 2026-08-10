# Add 30-day window guidance to Location Verdict

## Goal
Add a clear, non-intrusive note on the **Location Verdict** card that encourages users to view the verdict with a 30-day window and explains that small sample sizes skew the quality numbers.

## What will change
- `src/components/command/PortfolioVerdict.tsx`
  - In the single-location (non-agency) view, insert a compact info banner directly under the card header.
  - Banner copy: "Use a 30-day window for the most reliable Location Verdict. Shorter ranges have fewer leads, which can make the quality rate look unusually high or low."
  - Use the existing `Info` icon and a neutral slate/blue tone so it does not compete with the verdict color.
  - Keep the existing ring gauge, label, reason, and target text unchanged.
  - Only show the banner when the selected date range is **shorter than 30 days** or when the lead count is below the existing `LOW_SAMPLE_CAVEAT` threshold, so it does not nag users who are already looking at a full month of data.

## Out of scope
- No changes to the quality-rate math, thresholds, or ring gauge styling.
- No changes to the agency/portfolio rollup view.
- No backend or data model changes.

## Acceptance criteria
- Location Verdict card shows the 30-day guidance note for short windows or low sample counts.
- Note is hidden when the selected range is 30 days or longer and the lead count is at/above the caveat threshold.
- Card layout remains visually balanced and the existing verdict color/gauge behavior is preserved.
