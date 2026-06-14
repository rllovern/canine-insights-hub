// Ratio-of-sums helpers. Always sum numerator and denominator across scope
// THEN divide. Never average per-row rates — a small property would distort.

export function ctr(clicks: number, impressions: number): number {
  if (!impressions) return 0;
  return clicks / impressions;
}

export function cpl(spend: number, totalLeads: number): number {
  if (!totalLeads) return 0;
  return spend / totalLeads;
}

export function cpgl(spend: number, goodLeads: number): number {
  if (!goodLeads) return 0;
  return spend / goodLeads;
}

export function cpc(spend: number, clicks: number): number {
  if (!clicks) return 0;
  return spend / clicks;
}

export function responseRate(responded: number, total: number): number {
  if (!total) return 0;
  return responded / total;
}

export function ratio(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return numerator / denominator;
}

/** Sum a numeric field across rows. */
export function sumField<T>(rows: readonly T[], key: keyof T): number {
  let total = 0;
  for (const r of rows) {
    const v = r[key] as unknown as number | null | undefined;
    if (typeof v === "number" && Number.isFinite(v)) total += v;
  }
  return total;
}