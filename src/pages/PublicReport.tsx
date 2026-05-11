import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PublicShell } from "@/components/layout/PublicShell";
import { Property } from "@/lib/types";
import { useProperties } from "@/contexts/PropertyContext";
import { DashboardProvider } from "@/contexts/DashboardContext";
import type { MetricRow } from "@/lib/data-sources";
import Dashboard from "./Dashboard";
import CallTracking from "./CallTracking";
import { PublicReportToolbar } from "@/components/layout/PublicReportToolbar";

export default function PublicReport() {
  const { token } = useParams<{ token: string }>();
  const { setActiveProperty } = useProperties();
  const [property, setProperty] = useState<Property | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    supabase.rpc("get_property_by_report_token", { _token: token }).then(({ data, error }) => {
      if (error || !data || data.length === 0) {
        setError("This report link is invalid or has expired.");
      } else {
        const p = data[0] as Property;
        setProperty(p);
        setActiveProperty(p);
      }
    });
  }, [token, setActiveProperty]);

  if (error) return <div className="min-h-screen grid place-items-center text-muted-foreground">{error}</div>;
  if (!property || !token) return <div className="min-h-screen grid place-items-center"><Loader2 className="animate-spin" /></div>;

  const fetcher = async (from: string, to: string): Promise<MetricRow[]> => {
    const { data, error } = await supabase.rpc("get_daily_metrics_by_report_token", {
      _token: token, _from: from, _to: to,
    });
    if (error) throw error;
    return (data ?? []) as unknown as MetricRow[];
  };

  return (
    <DashboardProvider fetcher={fetcher} fetcherKey={`public:${token}`} enabled={true}>
      <PublicShell property={property} toolbar={<PublicReportToolbar />}>
        <div className="space-y-8">
          <Dashboard />
          <CallTracking />
        </div>
      </PublicShell>
    </DashboardProvider>
  );
}
