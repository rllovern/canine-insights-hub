import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type SpeedData = {
  total_leads: number;
  responded: number;
  never_responded: number;
  answered_inbound_only?: number;
  pct_never_responded: number;
  pct_under_1m: number;
  pct_under_5m: number;
  pct_under_15m: number;
  median_human_raw_seconds: number | null;
  median_human_business_seconds: number | null;
  median_human_engagement_seconds?: number | null;
  median_automation_seconds: number | null;
  median_ai_seconds: number | null;
  human_vs_automation_gap_seconds: number | null;
  currently_waiting: number;
  active_window_days: number;
  metric_definition?: string;
};

export type HandlingData = {
  new: number; assigned: number; contacted: number; engaged: number;
  avg_human_attempts: number; avg_automation_touches: number; avg_ai_touches: number; avg_total_touches: number;
  leads_zero_human_attempts: number; leads_one_human_attempt: number; leads_three_plus_attempts: number;
  stale_count: number; critical_stale_count: number;
  stale_after_hours: number; critical_stale_after_hours: number;
};

export type PipelineData = {
  needs_mapping: boolean;
  stages: Record<string, number>;
  transitions: Record<string, number>;
};

export type QualityData = {
  unassigned: number;
  missing_opportunities: number;
  no_disposition: number;
  duplicate_contacts: number;
  duplicate_opportunities: number;
  lost_without_reason: number;
  unmapped_stages: number;
  unknown_response_source: number;
  lead_facts_missing_contact: number;
  appointments_missing_status: number;
};

type Args = { propertyIds: string[] | null; from: Date; to: Date };

function useRpc<T>(fn: string, { propertyIds, from, to }: Args) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      // Guard against a picker producing a midnight-local `to`, which would
      // exclude every lead created on the chosen end date. Always send the
      // last instant of the selected end-of-day in the user's local TZ.
      const toEod = new Date(to);
      toEod.setHours(23, 59, 59, 999);
      const { data: d } = await (supabase.rpc as any)(fn, {
        _property_ids: propertyIds, _from: from.toISOString(), _to: toEod.toISOString(),
      });
      if (!cancelled) {
        setData((d ?? null) as T | null);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [fn, propertyIds, from, to]);
  return { data, loading };
}

export const useSpeed = (a: Args) => useRpc<SpeedData>("lead_perf_speed", a);
export const useHandling = (a: Args) => useRpc<HandlingData>("lead_perf_handling", a);
export const usePipeline = (a: Args) => useRpc<PipelineData>("lead_perf_pipeline", a);
export const useQuality = (a: Args) => useRpc<QualityData>("lead_perf_quality", a);