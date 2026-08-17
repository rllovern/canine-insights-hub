/**
 * Shared-account campaign scoping.
 *
 * NoVA and Winchester share one Google Ads account, so each location keeps an
 * allow-list of its own campaigns in `campaign_labels`. That allow-list is a
 * Google Ads concept: it only ever contains real Google Ads campaign names.
 *
 * Call-tracking rows (CTM) also land in `daily_metrics` under `Google PPC`,
 * but with generic tracking-source names like "Google Ads" or
 * "Google Call Asset" and zero cost / impressions / clicks. Those names can
 * never appear in the allow-list, so applying the allow-list to them silently
 * deletes most of a location's paid phone calls.
 *
 * Rule: a `Google PPC` row is excluded only when its campaign is a real
 * Google Ads campaign of the shared account (it carries spend signals, or it
 * is labeled to some property) AND it is not labeled to this property.
 * Everything else — including all call-tracking rows — passes through.
 */

export const PPC_SOURCE = "Google PPC";

export interface CampaignLabelRow {
  property_id: string;
  campaign: string;
}

export interface ScopableRow {
  property_id?: string | null;
  ad_source?: string | null;
  campaign?: string | null;
  cost?: number | string | null;
  impressions?: number | string | null;
  clicks?: number | string | null;
}

export interface CampaignScope {
  /** property_id -> campaigns labeled to that property. */
  allowed: Map<string, Set<string>>;
  /** Campaign names known to belong to the shared Google Ads account. */
  adsCampaigns: Set<string>;
}

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** True when a row carries Google Ads delivery signals (i.e. it came from the Ads sync). */
export function hasAdsSpendSignal(row: ScopableRow): boolean {
  return num(row.cost) > 0 || num(row.impressions) > 0 || num(row.clicks) > 0;
}

export function buildCampaignScope(
  labels: CampaignLabelRow[] | null | undefined,
  rows: ScopableRow[] | null | undefined,
): CampaignScope {
  const allowed = new Map<string, Set<string>>();
  const adsCampaigns = new Set<string>();
  for (const l of labels ?? []) {
    if (!l?.property_id || !l?.campaign) continue;
    if (!allowed.has(l.property_id)) allowed.set(l.property_id, new Set());
    allowed.get(l.property_id)!.add(l.campaign);
    adsCampaigns.add(l.campaign);
  }
  for (const r of rows ?? []) {
    if (r?.ad_source !== PPC_SOURCE || !r?.campaign) continue;
    if (hasAdsSpendSignal(r)) adsCampaigns.add(r.campaign);
  }
  return { allowed, adsCampaigns };
}

export function isRowInScope(row: ScopableRow, scope: CampaignScope): boolean {
  if (row?.ad_source !== PPC_SOURCE) return true;
  const set = row.property_id ? scope.allowed.get(row.property_id) : undefined;
  // Property ships no allow-list -> unfiltered.
  if (!set || set.size === 0) return true;
  const campaign = row.campaign ?? "";
  if (set.has(campaign)) return true;
  // Not labeled here. Drop it only if it's a real Ads campaign of the shared
  // account; otherwise it's a call-tracking row and belongs to this location.
  return !scope.adsCampaigns.has(campaign);
}

export function filterByCampaignScope<T extends ScopableRow>(
  rows: T[],
  labels: CampaignLabelRow[] | null | undefined,
): T[] {
  if (!labels || labels.length === 0) return rows;
  const scope = buildCampaignScope(labels, rows);
  return rows.filter((r) => isRowInScope(r, scope));
}
