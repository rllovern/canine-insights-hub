import { useEffect, useState } from "react";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { MonthlyReportData } from "./types";

export function useMonthlyReport(params: { propertyId?: string; token?: string; month: string } | null) {
  const [data, setData] = useState<MonthlyReportData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const key = params ? `${params.propertyId ?? ""}|${params.token ?? ""}|${params.month}` : "";
  useEffect(() => {
    if (!params) return;
    let cancelled = false;
    setLoading(true); setError(null); setData(null);
    supabase.functions
      .invoke("monthly-report-data", { body: { property_id: params.propertyId, token: params.token, month: params.month } })
      .then(async ({ data, error }) => {
        if (cancelled) return;
        if (error) {
          let msg = error.message;
          if (error instanceof FunctionsHttpError) {
            try { msg = (await error.context.json()).error ?? msg; } catch { /* keep */ }
          }
          setError(msg);
        } else setData(data as MonthlyReportData);
        setLoading(false);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return { data, error, loading };
}

export function lastFullMonth() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function recentMonths(n = 13) {
  const out: string[] = [];
  const d = new Date();
  d.setDate(1);
  for (let i = 0; i < n; i++) {
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    d.setMonth(d.getMonth() - 1);
  }
  return out;
}
