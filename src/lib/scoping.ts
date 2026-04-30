import { AppRole } from "./types";

/** SPAM time series + column visibility. Internal-only. */
export function canSeeSpam(role: AppRole | null | undefined): boolean {
  return role === "internal";
}

/** Bad-lead column visibility. Internal-only. */
export function canSeeBadLead(role: AppRole | null | undefined): boolean {
  return role === "internal";
}

/**
 * Cost visibility. Until per-property viewer-cost toggles ship, costs are
 * hidden from viewers and public reports by default.
 */
export function canSeeCost(
  role: AppRole | null | undefined,
  propertyConfig?: { viewer_can_see_cost?: boolean } | null,
): boolean {
  if (role === "internal") return true;
  return propertyConfig?.viewer_can_see_cost === true;
}

/** Convenience for components rendering in public-report mode. */
export const PUBLIC_ROLE: AppRole = "viewer";
