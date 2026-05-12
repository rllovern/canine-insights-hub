# Revert Chart Colors to Bright Palette

## Goal
Restore bright, distinguishable chart line colors on dashboard cards while keeping the current cream background, navy sidebar, and all other branded UI elements exactly as they are.

## Problem
The recent rebrand muted the `:root` (light mode) chart palette to navy/red/gold/cream/slate tones. On the cream card backgrounds, trend lines for impressions, calls, leads, and source data are now too similar and hard to distinguish.

## Change
Update only the 8 `--chart-*` CSS custom properties in the `:root` (light mode) block of `src/index.css` to bright, high-contrast colors spread across the hue wheel. The `.dark` mode chart values are already bright and will be left unchanged.

### New `:root` chart values
| Token | Current (muted) | Reverted (bright) |
|---|---|---|
| `--chart-1` | `222 60% 22%` (navy) | `142 60% 45%` (green) |
| `--chart-2` | `354 70% 48%` (red) | `217 85% 55%` (blue) |
| `--chart-3` | `42 75% 55%` (gold) | `32 95% 50%` (orange) |
| `--chart-4` | `36 35% 78%` (cream) | `280 65% 58%` (purple) |
| `--chart-5` | `222 12% 50%` (slate) | `0 78% 55%` (red) |
| `--chart-6` | `195 45% 42%` | `195 75% 55%` (teal) |
| `--chart-7` | `320 35% 48%` | `340 70% 60%` (pink) |
| `--chart-8` | `30 25% 55%` | `220 20% 50%` (slate-blue) |

## What stays the same
- `--background`, `--foreground`, `--card`, `--primary`, `--accent`, `--sidebar-*`, `--gold`, `--border`, `--gradient-*`, `--shadow-*`, `--section-*`
- All component code (`ChartCard.tsx`, `KpiCard.tsx`, `DualAxisChart.tsx`, `MultiLineChart.tsx`, etc.)
- `tailwind.config.ts`
- `.dark` theme values

## Result
Dashboard charts will immediately show vivid green, blue, orange, purple, and red trend lines that are easy to tell apart at a glance.