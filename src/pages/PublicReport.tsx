import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Property } from "@/lib/types";
import { useProperties } from "@/contexts/PropertyContext";
import { TokenReport } from "@/components/reports/TokenReport";

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
    // Intentionally only re-run when the token changes. setActiveProperty
    // identity is stable, and we don't want auth/role re-renders to refetch
    // the property and cascade resets into the dashboard state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (error) return <div className="min-h-screen grid place-items-center text-muted-foreground">{error}</div>;
  if (!property || !token) return <div className="min-h-screen grid place-items-center"><Loader2 className="animate-spin" /></div>;

  return <TokenReport token={token} property={property} />;
}
