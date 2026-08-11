# Budget Pacing: point-gap spend indicator

## Report first — all 7 properties, August 2026, day 11 of 31 (target 35.5%)

| Property | Budget | Spend MTD | Actual % | Target % | Gap (pts) | Current | New |
|---|---|---|---|---|---|---|---|
| Ashtabula | $6,000 | $2,073 | 34.5% | 35.5% | -0.9 | Red | **Green** — On pace |
| Central IL | $540 | $297 | 55.0% | 35.5% | +19.5 | Red | Red — Ahead of pace |
| DFW | $2,000 | $596 | 29.8% | 35.5% | -5.7 | Red | **Amber** — Slightly behind pace |
| MoCo | $7,500 | $2,724 | 36.3% | 35.5% | +0.8 | Red | **Green** — On pace |
| Colorado Springs | $6,000 | $2,447 | 40.8% | 35.5% | +5.3 | Red | **Amber** — Slightly ahead of pace |
| NoVA | $17,000 | $5,973 | 35.1% | 35.5% | -0.4 | Red | **Green** — On pace |
| Winchester | $10,000 | $3,396 | 34.0% | 35.5% | -1.5 | Red | **Green** — On pace (acceptance test passes) |

Every property currently renders red because the old band compares actual spend to 100% of budget instead of to elapsed-time pace.

**Early-month floor check (day >= 8, actual < half of target = 17.7%):** catches nothing today — no property is below 17.7% spend. It stays in as a silent-failure guard for an account that spends almost nothing after the 1st.

## What changes

- New config module `src/lib/budgetPacing.ts` holding the only literals: on-pace band 5 points, off-pace band 15 points, early-month floor (from day 8, actual < 0.5x target -> amber). It exports `pacingVerdict()` returning tone, label and the tooltip sentence.
- `BudgetPacing.tsx`: delete the hardcoded 0.05 / 0.15 / 0.3 `paceTone` function and call the shared helper.
- Labels distinguish direction: "On pace", "Slightly ahead of pace" / "Slightly behind pace", "Ahead of pace" / "Behind pace".
- Tooltip on the % Spend cell: "34.0% spent, 35.5% expected by day 11 of 31. 1.5 points behind."
- No budget set (monthly_budget 0 or null): cell renders "No budget configured" in muted grey — no percentage, no color. Zero spend with a budget behaves normally (0.0%, gap = -target).
- Card note: "Pacing is always month-to-date against the calendar month, regardless of the selected date range."

## Open confirmations before shipping

1. **Last day of month.** With target = 100%, 85% spend is amber and 84% is red — that is what the bands say, but on the 31st most accounts land there. Confirm you want it, or the bands can widen on the final two days.
2. **Proj Run Rate column** uses the same old band. Its target is 100% of budget for the full month, so the plan is to apply the same 5/15-point bands against 100% (86% run rate -> 14 points under -> amber). Say if that column should be left alone.

## Technical notes

- `daysElapsed` counts today as fully elapsed (day-of-month); `daysInMonth` is calendar days. Both already exist in the `monthRange` helper.
- Gap is an absolute percentage-point difference: `actualPct - targetPct`, never a relative difference.
- For a past month selected in the picker, target is 100% (month fully elapsed) and the same bands apply.