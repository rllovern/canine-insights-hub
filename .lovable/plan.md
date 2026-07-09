## Goal
Rename the "Total Calls" chart on the Call Performance page to "Total Records" and update its subtitle to indicate it includes both calls and forms.

## Changes

### `src/pages/CallTracking.tsx`
- Line 154: Change `ChartCard` title from `"Total Calls"` → `"Total Records"`.
- Line 154: Change subtitle from `"All sources, daily"` → `"Calls and forms"`.
- Line 155: Change `SingleLineChart` label from `"Calls"` → `"Records"`.

No backend or data changes are needed — the chart already reads `record_count` (calls + forms).