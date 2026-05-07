import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PublicShell } from "@/components/layout/PublicShell";
import { Property } from "@/lib/types";

export default function PublicReport() {
  const { token } = useParams<{ token: string }>();
  const [property, setProperty] = useState<Property | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    supabase.rpc("get_property_by_report_token", { _token: token }).then(({ data, error }) => {
      if (error || !data || data.length === 0) setError("This report link is invalid or has expired.");
      else setProperty(data[0] as Property);
    });
  }, [token]);

  if (error) return <div className="min-h-screen grid place-items-center text-muted-foreground">{error}</div>;
  if (!property) return <div className="min-h-screen grid place-items-center"><Loader2 className="animate-spin" /></div>;

  return (
    <PublicShell property={property}>
      <div className="text-sm text-muted-foreground">Public report for {property.name}.</div>
    </PublicShell>
  );
}