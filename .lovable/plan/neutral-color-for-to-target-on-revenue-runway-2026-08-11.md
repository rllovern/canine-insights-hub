# Neutral color for "% to target" on Revenue Runway

## What changes

The "% to target" tile currently turns green when the value is at or above 100% and red when below. Both colorings are removed so the number always renders in the same neutral tone as the "Target" and "Projected finish" tiles.

- No green, no red, no threshold styling on that tile.
- The value, caption, and all other tiles stay exactly as they are.
- No change to how the percentage is calculated.

## Technical notes

- In `src/components/sales/RevenueRunway.tsx`, the `% to target` `<Stat>` gets a fixed `tone` instead of the conditional up/down expression.
- The now-unused `up` / `down` branches inside the `Stat` helper are dropped along with those tone options, since no other tile uses them.
