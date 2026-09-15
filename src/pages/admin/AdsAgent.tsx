import { useState } from "react";
import { Loader2, Activity, AlertCircle, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Freshness = { last_success_at: string | null; age_hours: number | null; state: string };

interface HealthProperty {
  property_id: string;
  property_name: string;
  customer_id: string;
  error: string | null;
  campaign_count: number | null;
  campaigns: { id: string; name: string; status: string }[];
  allowlist: string[] | null;
  allowlist_configured: boolean;
  campaigns_outside_allowlist: { id: string; name: string }[];
  source_freshness: Record<string, Freshness>;
}

interface HealthResult {
  checked_at: string;
  properties: HealthProperty[];
  note?: string;
  error?: string;
}

const SOURCE_LABELS: Record<string, string> = {
  google_ads: "Google Ads",
  ctm: "Call tracking",
  ghl: "CRM",
};

function FreshnessCell({ f }: { f?: Freshness }) {
  if (!f || f.age_hours === null) {
    return <span className="text-muted-foreground">{f?.state ?? "no data"}</span>;
  }
  return (
    <span className={cn(f.age_hours > 24 ? "text-amber-600" : "text-foreground")}>
      {f.age_hours}h
    </span>
  );
}

export default function AdsAgent() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<HealthResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setLoading(true);
    setError(null);
    const { data, error: invokeError } = await supabase.functions.invoke("ads-agent-health");
    setLoading(false);
    if (invokeError) {
      setError(invokeError.message);
      setResult(null);
      return;
    }
    const payload = data as HealthResult;
    if (payload?.error) {
      setError(payload.error);
      setResult(null);
      return;
    }
    setResult(payload);
  };

  return (
    <div className="space-y-4">
      <div className="border-b border-border pb-3">
        <h1 className="text-lg font-semibold tracking-tight">Ads Agent</h1>
        <p className="text-[12px] text-muted-foreground mt-0.5">
          Read-only health check. Reads campaigns from Google Ads for every agent-enabled account and
          reports data freshness. It makes no changes to any ad account.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold">Account health</div>
            <div className="text-[11px] text-muted-foreground">
              {result
                ? `Last checked ${new Date(result.checked_at).toLocaleString()}`
                : "Not run yet in this session."}
            </div>
          </div>
          <Button size="sm" onClick={run} disabled={loading}>
            {loading
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Checking…</>
              : <><Activity className="h-3.5 w-3.5 mr-1.5" /> Run health check</>}
          </Button>
        </div>

        {error && (
          <div className="flex items-start gap-2 px-4 py-3 text-[12px] text-destructive">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {result && result.properties.length === 0 && (
          <div className="px-4 py-6 text-center text-[12px] text-muted-foreground">
            No agent-enabled accounts. Add rows to the agent account policies table and turn one on to
            see results here.
          </div>
        )}

        {result && result.properties.length > 0 && (
          <table className="w-full text-xs">
            <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left font-medium px-4 py-2">Location</th>
                <th className="text-left font-medium px-2 py-2">Customer ID</th>
                <th className="text-left font-medium px-2 py-2">Campaigns</th>
                <th className="text-left font-medium px-2 py-2">Allowlist</th>
                <th className="text-left font-medium px-2 py-2">Google Ads</th>
                <th className="text-left font-medium px-2 py-2">Call tracking</th>
                <th className="text-left font-medium px-2 py-2">CRM</th>
              </tr>
            </thead>
            <tbody>
              {result.properties.map((p) => (
                <tr key={`${p.property_id}:${p.customer_id}`} className="border-t border-border/60 align-top">
                  <td className="px-4 py-2 font-medium">
                    {p.property_name}
                    {p.error && (
                      <div className="text-[11px] text-destructive font-normal mt-0.5 max-w-[320px] truncate" title={p.error}>
                        {p.error}
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-2 text-muted-foreground">{p.customer_id}</td>
                  <td className="px-2 py-2">
                    {p.campaign_count === null ? "—" : p.campaign_count}
                    {p.campaigns.length > 0 && (
                      <div className="text-[11px] text-muted-foreground max-w-[260px] truncate" title={p.campaigns.map((c) => `${c.id} · ${c.name}`).join("\n")}>
                        {p.campaigns.slice(0, 3).map((c) => c.name).join(", ")}
                        {p.campaigns.length > 3 ? ` +${p.campaigns.length - 3}` : ""}
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    {!p.allowlist_configured ? (
                      <span className="text-muted-foreground">Not set</span>
                    ) : p.campaigns_outside_allowlist.length === 0 ? (
                      <span className="inline-flex items-center gap-1 text-success">
                        <CheckCircle2 className="h-3 w-3" /> All inside
                      </span>
                    ) : (
                      <span
                        className="text-amber-600"
                        title={p.campaigns_outside_allowlist.map((c) => `${c.id} · ${c.name}`).join("\n")}
                      >
                        {p.campaigns_outside_allowlist.length} outside
                      </span>
                    )}
                  </td>
                  {(["google_ads", "ctm", "ghl"] as const).map((src) => (
                    <td key={src} className="px-2 py-2" title={SOURCE_LABELS[src]}>
                      <FreshnessCell f={p.source_freshness?.[src]} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
