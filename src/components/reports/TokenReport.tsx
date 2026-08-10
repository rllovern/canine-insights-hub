import { forwardRef, useEffect, useMemo, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Property } from "@/lib/types";
import { DashboardProvider } from "@/contexts/DashboardContext";
import { PublicTokenProvider } from "@/contexts/PublicTokenContext";
import { useProperties } from "@/contexts/PropertyContext";
import { useAuth } from "@/contexts/AuthContext";
import { PublicShell } from "@/components/layout/PublicShell";
import { PublicReportToolbar } from "@/components/layout/PublicReportToolbar";
import { DataFreshnessLine } from "@/components/reports/DataFreshnessLine";
import { RestatedBadge } from "@/components/reports/RestatedBadge";
import type { MetricRow } from "@/lib/data-sources";
import Dashboard from "@/pages/Dashboard";
import CallTracking from "@/pages/CallTracking";

/**
 * For anonymous visitors the authenticated property list is empty, so scope
 * resolves to null and every page renders "Select a client". Inject the
 * token-resolved property for the lifetime of the report.
 */
function PublicScopeBridge({ property }: { property: Property }) {
  const { user } = useAuth();
  const { setPublicProperty } = useProperties();
  useEffect(() => {
    if (user) return;
    setPublicProperty(property);
    return () => setPublicProperty(null);
  }, [user, property, setPublicProperty]);
  return null;
}

/**
 * Renders the exact client-facing token report (header, toolbar, dashboard,
 * call tracking). Used by:
 *  - /report/:token  (public, no auth)
 *  - /admin/client-reports  (internal, with a client switcher injected
 *    via the toolbar `leading` slot)
 */
export const TokenReport = forwardRef<
  HTMLDivElement,
  { token: string; property: Property; toolbarExtras?: ReactNode }
>(function TokenReport({ token, property, toolbarExtras }, ref) {
  const fetcher = async (from: string, to: string): Promise<MetricRow[]> => {
    const { data, error } = await supabase.rpc("get_daily_metrics_by_report_token", {
      _token: token,
      _from: from,
      _to: to,
    });
    if (error) throw error;
    return (data ?? []) as unknown as MetricRow[];
  };

  // Local QueryClient so the tokenized report view does NOT auto-refetch on
  // window focus / reconnect. The toolbar state lives in DashboardProvider and
  // is preserved across the user's session — we don't want the page to feel
  // like it's "refreshing" while a client is reviewing.
  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
            refetchOnReconnect: false,
            staleTime: 5 * 60 * 1000,
          },
        },
      }),
    [token]
  );

  return (
    <QueryClientProvider client={queryClient}>
      <PublicTokenProvider token={token}>
      <PublicScopeBridge property={property} />
      <DashboardProvider fetcher={fetcher} fetcherKey={`public:${token}`} enabled={true}>
      <div ref={ref}>
        <PublicShell
          property={property}
          toolbar={
            <>
              <PublicReportToolbar />
              {toolbarExtras}
            </>
          }
        >
          <div className="space-y-8">
            <DataFreshnessLine token={token} />
            <RestatedBadge token={token} />
            <Dashboard />
            <CallTracking />
          </div>
        </PublicShell>
      </div>
      </DashboardProvider>
      </PublicTokenProvider>
    </QueryClientProvider>
  );
});