/**
 * Budget pacing configuration + verdict.
 *
 * Pacing compares month-to-date spend against elapsed time in the calendar
 * month. The gap is an absolute difference in PERCENTAGE POINTS
 * (actualPct - targetPct), never a relative difference.
 */

export const PACING_CONFIG = {
  /** |gap| <= this many points -> green ("On pace"). */
  onPacePoints: 5,
  /** |gap| <= this many points -> amber. Above it -> red. */
  offPacePoints: 15,
  /** Early-month underspend floor: from this day of month onward... */
  floorFromDay: 8,
  /** ...if actualPct < this fraction of targetPct, force at least amber. */
  floorRatio: 0.5,
} as const;

export type PacingTone = "green" | "amber" | "red" | "none";

export type PacingVerdict = {
  tone: PacingTone;
  /** Tailwind classes for the badge. */
  className: string;
  /** Short direction-aware label. */
  label: string;
  /** Full explanation with the math. */
  tooltip: string;
  /** actual - target, in percentage points (e.g. -1.5). Null when no budget. */
  gapPoints: number | null;
};

const TONE_CLASS: Record<PacingTone, string> = {
  green: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  amber: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  red: "bg-red-500/15 text-red-700 dark:text-red-300",
  none: "bg-muted/30 text-muted-foreground",
};

const pct1 = (fraction: number) => `${(fraction * 100).toFixed(1)}%`;

export const NO_BUDGET_LABEL = "No budget configured";

export const PACING_SCOPE_NOTE =
  "Pacing is always month-to-date against the calendar month, regardless of the selected date range.";

/**
 * @param spend      month-to-date spend
 * @param budget     monthly budget (0/null = not configured)
 * @param daysElapsed day of month, counting today as fully elapsed
 * @param daysInMonth calendar days in the month
 */
export function pacingVerdict(
  spend: number,
  budget: number | null | undefined,
  daysElapsed: number,
  daysInMonth: number,
): PacingVerdict {
  if (!budget || !isFinite(budget) || budget <= 0) {
    return {
      tone: "none",
      className: TONE_CLASS.none,
      label: NO_BUDGET_LABEL,
      tooltip: `${NO_BUDGET_LABEL}. Set a monthly budget to see pacing.`,
      gapPoints: null,
    };
  }

  const actualPct = spend / budget;
  const targetPct = daysInMonth > 0 ? Math.min(1, daysElapsed / daysInMonth) : 1;
  const gapPoints = (actualPct - targetPct) * 100;
  const abs = Math.abs(gapPoints);
  const ahead = gapPoints > 0;

  let tone: PacingTone;
  let label: string;
  if (abs <= PACING_CONFIG.onPacePoints) {
    tone = "green";
    label = "On pace";
  } else if (abs <= PACING_CONFIG.offPacePoints) {
    tone = "amber";
    label = ahead ? "Slightly ahead of pace" : "Slightly behind pace";
  } else {
    tone = "red";
    label = ahead ? "Ahead of pace" : "Behind pace";
  }

  // Early-month underspend floor: point bands can't reach red early in the
  // month, so a location spending almost nothing would read green.
  let floorNote = "";
  if (
    tone === "green" &&
    daysElapsed >= PACING_CONFIG.floorFromDay &&
    actualPct < targetPct * PACING_CONFIG.floorRatio
  ) {
    tone = "amber";
    label = "Slightly behind pace";
    floorNote = ` Spend is under half the expected pace by day ${daysElapsed}.`;
  }

  const direction = abs < 0.05 ? "exactly on pace" : `${abs.toFixed(1)} points ${ahead ? "ahead" : "behind"}`;
  const tooltip =
    `${pct1(actualPct)} spent, ${pct1(targetPct)} expected by day ${daysElapsed} of ${daysInMonth}. ` +
    `${direction.charAt(0).toUpperCase()}${direction.slice(1)}.${floorNote} ${PACING_SCOPE_NOTE}`;

  return { tone, className: TONE_CLASS[tone], label, tooltip, gapPoints };
}

/**
 * Projected run rate is measured against 100% of budget for the full month,
 * using the same point bands.
 */
export function runRateVerdict(projection: number, budget: number | null | undefined): PacingVerdict {
  if (!budget || !isFinite(budget) || budget <= 0) {
    return {
      tone: "none",
      className: TONE_CLASS.none,
      label: NO_BUDGET_LABEL,
      tooltip: `${NO_BUDGET_LABEL}. Set a monthly budget to see the projected run rate.`,
      gapPoints: null,
    };
  }
  const ratio = projection / budget;
  const gapPoints = (ratio - 1) * 100;
  const abs = Math.abs(gapPoints);
  const ahead = gapPoints > 0;
  let tone: PacingTone;
  let label: string;
  if (abs <= PACING_CONFIG.onPacePoints) {
    tone = "green";
    label = "Projected to land on budget";
  } else if (abs <= PACING_CONFIG.offPacePoints) {
    tone = "amber";
    label = ahead ? "Projected slightly over budget" : "Projected slightly under budget";
  } else {
    tone = "red";
    label = ahead ? "Projected over budget" : "Projected under budget";
  }
  const tooltip = `${pct1(ratio)} of budget projected for the full month — ${label.toLowerCase()} (${abs.toFixed(1)} points ${ahead ? "over" : "under"} 100%).`;
  return { tone, className: TONE_CLASS[tone], label, tooltip, gapPoints };
}