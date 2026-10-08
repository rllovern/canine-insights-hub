import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Asks the server whether the signed-in account holds the Marketing Ops grant.
 * Cosmetic only (menu + route); every data request is re-checked server-side.
 */
export function useMopsAccess() {
  const { user } = useAuth();
  const qc = useQueryClient();
  useEffect(() => {
    if (!user) qc.removeQueries({ queryKey: ["mops"] });
  }, [user, qc]);
  const q = useQuery({
    queryKey: ["mops", "access", user?.id],
    enabled: !!user,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("mops_my_access");
      if (error) return false;
      return Boolean(data);
    },
  });
  return { hasAccess: !!user && q.data === true, loading: !!user && q.isLoading };
}
