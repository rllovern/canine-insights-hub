import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Property } from "@/lib/types";
import { PublicShell } from "@/components/layout/PublicShell";
import { PropertyOverview } from "@/components/data/PropertyOverview";
import { BrandMark } from "@/components/brand/BrandMark";

export default function PublicReport() {
  const { token } = useParams();
  const [property, setProperty] = useState<Property | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "notfound">("loading");

  useEffect(() => {
    if (!token) {
      setStatus("notfound");
      return;
    }
    (async () => {
      const { data, error } = await supabase.rpc("get_property_by_report_token", { _token: token });
      if (error || !data || data.length === 0) {
        setStatus("notfound");
        return;
      }
      setProperty(data[0] as Property);
      setStatus("ok");
    })();
  }, [token]);

  if (status === "loading") {
    return <div className="grid min-h-screen place-items-center text-sm text-muted-foreground">Loading report…</div>;
  }

  if (status === "notfound" || !property) {
    return (
      <div className="grid min-h-screen place-items-center bg-background p-6">
        <div className="max-w-sm text-center">
          <BrandMark className="mx-auto mb-6 justify-center" />
          <h1 className="text-lg font-semibold">Report not found</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This share link is invalid or has been revoked. Please contact your account manager for a new link.
          </p>
        </div>
      </div>
    );
  }

  return (
    <PublicShell property={property}>
      <PropertyOverview readOnly />
    </PublicShell>
  );
}