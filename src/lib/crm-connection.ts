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
}

export function useCrmConnection(propertyIds: string[] | null, enabled = true): CrmConnection {
  const q = useQuery({
    enabled,
    queryKey: ["crm-connection", propertyIds?.join(",") ?? "all"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      let sel = supabase
        .from("property_data_sources")
        .select("property_id, is_connected, status")
        .eq("source", "ghl");
      if (propertyIds) sel = sel.in("property_id", propertyIds);
      const { data, error } = await sel;
      if (error) return { connected: [] as string[], all: propertyIds ?? [] };
      const connected = (data ?? [])
        .filter((r) => r.is_connected && r.status !== "paused")
        .map((r) => r.property_id as string);
      return { connected, all: propertyIds ?? (data ?? []).map((r) => r.property_id as string) };
    },
  });

  const connectedIds = q.data?.connected ?? [];
  const all = q.data?.all ?? propertyIds ?? [];
  const unconnectedIds = all.filter((id) => !connectedIds.includes(id));
  return {
    connectedIds,
    unconnectedIds,
    noneConnected: !q.isLoading && all.length > 0 && connectedIds.length === 0,
    isLoading: q.isLoading,
  };
}
