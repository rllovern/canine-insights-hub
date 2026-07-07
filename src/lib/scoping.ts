import { AppRole } from "./types";

/** Roles that see every property and every metric column. */
function isAllPropertiesReader(role: AppRole | null | undefined): boolean {
  return role === "super_admin" || role === "admin" || role === "owner";
}

/** SPAM time series + column visibility. Internal staff & Owner only. */
export function canSeeSpam(role: AppRole | null | undefined): boolean {
  return isAllPropertiesReader(role);
}

/** Bad-lead column visibility. Internal staff & Owner only. */
export function canSeeBadLead(role: AppRole | null | undefined): boolean {
  return isAllPropertiesReader(role);
}

/**
 * Cost visibility. Location Owners see cost only when the per-property
 * viewer_can_see_cost flag is on. Everyone above them always sees cost.
 */
export function canSeeCost(
  role: AppRole | null | undefined,
  propertyConfig?: { viewer_can_see_cost?: boolean } | null,
): boolean {
  if (isAllPropertiesReader(role)) return true;
  return propertyConfig?.viewer_can_see_cost === true;
}

/** Convenience for components rendering in public-report mode. */
export const PUBLIC_ROLE: AppRole = "location_owner";
