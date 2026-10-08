import { supabase } from "@/integrations/supabase/client";

/** Calls the private Marketing Ops endpoint. Identity comes from the session token only. */
export async function mopsCall<T = any>(op: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke("mops-api", { body: { op, args } });
  if (error) {
    let msg = "Request failed";
    try { const b = await (error as any).context?.json?.(); if (b?.error) msg = b.error; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return data as T;
}

export async function mopsSummary(propertyId: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke("mops-ai", { body: { property_id: propertyId } });
  if (error) {
    let msg = "Summary failed";
    try { const b = await (error as any).context?.json?.(); if (b?.error) msg = b.error; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return (data as { summary: string }).summary;
}

export const STAGE_LABEL: Record<string, string> = {
  questionnaire: "Questionnaire", access_discovery: "Access & Discovery", configuration: "Configuration",
  validation: "Validation & Testing", active: "Active", paused: "Paused", archived: "Archived",
};
export const REQ_STATUS_LABEL: Record<string, string> = {
  not_started: "Not started", awaiting_access: "Awaiting access", in_progress: "In progress",
  awaiting_verification: "Awaiting verification", verified: "Verified", blocked: "Blocked", not_applicable: "Not applicable",
};
export const Q_LABEL: Record<string, string> = {
  unknown: "Unknown (legacy)", not_sent: "Not sent", sent: "Sent", in_progress: "In progress", submitted: "Submitted",
};
export const PLATFORM_LABEL: Record<string, string> = {
  google_ads: "Google Ads", ga4: "Google Analytics 4", gtm: "Tag Manager", search_console: "Search Console",
  gbp: "Business Profile", website: "Website / CMS", ctm: "CallTrackingMetrics", ghl: "GoHighLevel",
};
export const AREA_LABEL: Record<string, string> = {
  access: "Access & Assets", google_ads: "Google Ads Configuration", ctm: "Call Tracking & Attribution",
  ghl_forms: "GHL Form Attribution", website: "Website / Landing Page", billing: "Budget & Billing",
};
