import { forwardRef, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Property } from "@/lib/types";
import { DashboardProvider } from "@/contexts/DashboardContext";
import { PublicShell } from "@/components/layout/PublicShell";
import { PublicReportToolbar } from "@/components/layout/PublicReportToolbar";
import type { MetricRow } from "@/lib/data-sources";
import Dashboard from "@/pages/Dashboard";
import CallTracking from "@/pages/CallTracking";

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

  return (
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
            <Dashboard />
            <CallTracking />
          </div>
        </PublicShell>
      </div>
    </DashboardProvider>
  );
});