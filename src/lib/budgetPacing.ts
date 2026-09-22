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
  /**
   * Fraction of the month's budget that should be spent by now. Defaults to
   * elapsed days / days in month. A mid-month budget change makes the expected
   * curve uneven, so the caller passes the prorated fraction instead.
   */
  targetFractionOverride?: number | null,
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
  const targetPct =
    targetFractionOverride != null && isFinite(targetFractionOverride)
      ? Math.max(0, Math.min(1, targetFractionOverride))
      : daysInMonth > 0
        ? Math.min(1, daysElapsed / daysInMonth)
        : 1;
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
/**
 * Local Services (LSA) and other Google-auto-generated campaigns carry their own
 * separate budget and should not roll into the PPC active budget / pacing math.
 */
const EXCLUDED_CAMPAIGN_RE = /^localservicescampaign[:\s]|systemgenerated|^local services/i;

export function isExcludedCampaign(name: string | null | undefined): boolean {
  if (!name) return false;
  return EXCLUDED_CAMPAIGN_RE.test(name.trim());
}

/**
 * Spend is stored per (property, campaign NAME). Google Ads campaign names are
 * not stable — a rename starts a brand-new history line and leaves the old one
 * behind, so the same spend gets counted twice. A campaign name that carries
 * spend but no longer appears in the live campaign snapshot for that property
 * is the signature of exactly that. Campaign identity is campaign.id; names
 * must never be treated as identity across properties.
 */
export type OrphanCampaign = { propertyId: string; campaign: string; cost: number };

export function findOrphanCampaigns(
  metrics: Array<{ property_id: string; campaign: string | null; cost: number | null }>,
  budgets: Array<{ property_id: string; campaign: string }>,
): OrphanCampaign[] {
  const known = new Map<string, Set<string>>();
  for (const b of budgets) {
    let set = known.get(b.property_id);
    if (!set) { set = new Set(); known.set(b.property_id, set); }
    set.add(b.campaign);
  }
  const totals = new Map<string, OrphanCampaign>();
  for (const m of metrics) {
    const name = (m.campaign ?? "").trim();
    const cost = Number(m.cost || 0);
    if (!name || cost <= 0) continue;
    if (isExcludedCampaign(name)) continue;
    const set = known.get(m.property_id);
    // No snapshot for this property yet — can't tell, so don't warn.
    if (!set || set.size === 0 || set.has(name)) continue;
    const key = `${m.property_id}::${name}`;
    const prev = totals.get(key);
    if (prev) prev.cost += cost;
    else totals.set(key, { propertyId: m.property_id, campaign: name, cost });
  }
  return Array.from(totals.values()).sort((a, b) => b.cost - a.cost);
}

/**
 * Mid-month budget changes.
 *
 * The monthly budget on a row is a single number, but it can change part way
 * through the month. Judging month-to-date spend against the new full-month
 * figure makes a location that halved its budget on the 10th look wildly over
 * (or under) budget. Instead we prorate: each day of the month is worth
 * (budget in effect that day / days in month), and both the month's budget and
 * the expected-by-now figure are the sums of those daily amounts.
 */
export type BudgetChange = {
  property_id: string;
  effective_date: string; // YYYY-MM-DD
  monthly_budget: number;
  previous_budget: number | null;
  note: string | null;
};

export type BudgetProfile = {
  /** Blended budget for the whole month. */
  monthlyEquivalent: number;
  /** Prorated amount that should have been spent by the elapsed day. */
  expectedToDate: number;
  /** expectedToDate / monthlyEquivalent, for the pacing bands. */
  expectedFraction: number | null;
  /** True when a change took effect after the 1st of the month. */
  changedMidMonth: boolean;
  changes: BudgetChange[];
};

export function buildBudgetProfile(
  currentBudget: number,
  changesInMonth: BudgetChange[],
  totalDays: number,
  daysElapsed: number,
): BudgetProfile {
  const changes = [...changesInMonth]
    .filter((c) => Number(c.effective_date.slice(8, 10)) > 1)
    .sort((a, b) => a.effective_date.localeCompare(b.effective_date));

  if (changes.length === 0 || totalDays <= 0) {
    const monthlyEquivalent = Number(currentBudget) || 0;
    const expectedFraction = totalDays > 0 ? Math.min(1, daysElapsed / totalDays) : 1;
    return {
      monthlyEquivalent,
      expectedToDate: monthlyEquivalent * expectedFraction,
      expectedFraction: monthlyEquivalent > 0 ? expectedFraction : null,
      changedMidMonth: false,
      changes: [],
    };
  }

  // Budget in force before the first change of the month: what the first change
  // recorded as the previous value, falling back to today's figure.
  const startBudget = Number(changes[0].previous_budget ?? currentBudget) || 0;

  let monthlyEquivalent = 0;
  let expectedToDate = 0;
  for (let day = 1; day <= totalDays; day++) {
    let inForce = startBudget;
    for (const c of changes) {
      if (Number(c.effective_date.slice(8, 10)) <= day) inForce = Number(c.monthly_budget) || 0;
      else break;
    }
    const daily = inForce / totalDays;
    monthlyEquivalent += daily;
    if (day <= daysElapsed) expectedToDate += daily;
  }

  return {
    monthlyEquivalent,
    expectedToDate,
    expectedFraction: monthlyEquivalent > 0 ? expectedToDate / monthlyEquivalent : null,
    changedMidMonth: true,
    changes,
  };
}
