// Sales surfaces read GHL (`ghl_opportunities`) exclusively. A property with no
// GHL connection has no sales data at all — it must render "No CRM connected"
// rather than a zero, which would read as "sold nothing".
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface CrmConnection {
  /** property ids in scope that have a connected GHL source */
  connectedIds: string[];
  /** property ids in scope with no connected GHL source */
  unconnectedIds: string[];
  /** true when nothing in scope has a CRM — sales cannot be reported at all */
  noneConnected: boolean;
  isLoading: boolean;
  /** true when the backend could not answer — status is unknown, NOT "disconnected" */
  isError: boolean;
}

export function useCrmConnection(propertyIds: string[] | null, enabled = true): CrmConnection {
  const q = useQuery({
    enabled,
    queryKey: ["crm-connection", propertyIds?.join(",") ?? "all"],
    staleTime: 5 * 60 * 1000,
    retry: 1,
    queryFn: async () => {
      // Security-definer RPC: readable by every role that can see the property,
      // so CRM status never depends on staff-only table access. Errors are
      // thrown (never swallowed) — an unanswered request must not be rendered
      // as "No CRM connected".
      const { data, error } = await supabase.rpc("crm_connection_status", {
        _property_ids: propertyIds ?? undefined,
      });
      if (error) throw error;
      const rows = (data ?? []) as { property_id: string; connected: boolean }[];
      const connected = rows.filter((r) => r.connected).map((r) => r.property_id);
      return { connected, all: propertyIds ?? rows.map((r) => r.property_id) };
    },
  });

  const connectedIds = q.data?.connected ?? [];
  const all = q.data?.all ?? propertyIds ?? [];
  const unconnectedIds = all.filter((id) => !connectedIds.includes(id));
  // Only a successful answer may claim "no CRM". Loading and error states keep
  // the normal value on screen.
  const answered = q.isSuccess;
  return {
    connectedIds,
    unconnectedIds,
    noneConnected: answered && all.length > 0 && connectedIds.length === 0,
    isLoading: q.isPending,
    isError: q.isError,
  };
}
