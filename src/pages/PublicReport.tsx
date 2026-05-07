import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PublicAuthProvider, type Property } from "@/contexts/AuthContext";
import { DashboardProvider } from "@/contexts/DashboardContext";
import type { MetricRow } from "@/lib/data-sources";
import { PpcOverviewBody } from "./PpcOverview";
import { CallTrackingBody } from "./CallTracking";
import { PublicShell } from "@/components/layout/PublicShell";
import { SectionDivider } from "@/components/dashboard/SectionDivider";
import { AIAssistant } from "@/components/ai/AIAssistant";

export default function PublicReport() {
  const { token } = useParams<{ token: string }>();
  const [client, setClient] = useState<Property | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Redirect old lovable.app share links to the canonical custom domain.
    if (typeof window !== "undefined" && token) {
      const host = window.location.hostname;
      const CANONICAL_HOST = "ridgeside-canine.lovable.app";
      if (host.endsWith(".lovable.app") && host !== CANONICAL_HOST) {
        window.location.replace(`https://${CANONICAL_HOST}/report/${token}${window.location.search}`);
      }
    }
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!token) {
        setError("Missing report token.");
        setLoading(false);
        return;
      }
      const { data, error } = await supabase.rpc("public_report_client", { _token: token });
      if (cancelled) return;
      if (error) {
        setError("This report link is invalid or has expired.");
      } else if (!data || data.length === 0) {
        setError("This report link is invalid or has expired.");
      } else {
        setClient(data[0] as Property);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !client) {
    return (
      <div className="min-h-screen grid place-items-center bg-background px-6">
        <div className="text-center max-w-md">
          <div className="mx-auto mb-5 h-12 w-12 rounded-xl bg-gradient-brand grid place-items-center text-white text-lg font-bold tracking-tight">
            A
          </div>
          <div className="text-3xl font-bold tracking-tight mb-2">Report unavailable</div>
          <p className="text-muted-foreground">
            We couldn't load this report right now. Please contact your Ridgeside Canine account manager for an updated link.
          </p>
          <div className="mt-6 text-[11px] uppercase tracking-[0.18em] text-muted-foreground/70">
            Ridgeside Canine Performance Reporting
          </div>
        </div>
      </div>
    );
  }

  const fetcher = async (from: string, to: string): Promise<MetricRow[]> => {
    const { data, error } = await supabase.rpc("public_report_metrics", {
      _token: token!,
      _from: from,
      _to: to,
    });
    if (error) throw error;
    return (data ?? []) as MetricRow[];
  };

  return (
    <PublicAuthProvider client={client}>
      <DashboardProvider fetcher={fetcher} fetcherKey={`public:${token}`} enabled>
        <PublicShell>
          <PpcOverviewBody />
          <div className="h-2" />
          <CallTrackingBody />
          <AIAssistant forceViewerRole publicToken={token} />
        </PublicShell>
      </DashboardProvider>
    </PublicAuthProvider>
  );
}
