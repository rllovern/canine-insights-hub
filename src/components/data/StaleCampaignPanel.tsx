import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { findOrphanCampaigns } from "@/lib/budgetPacing";

type Row = { property_id: string; campaign: string | null; cost: number | null };

const fmtUSD = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function isoDaysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

/**
 * Surfaces campaign names that still carry spend but no longer exist in the
 * live Google Ads snapshot — almost always a renamed campaign whose old history
 * line is now double-counting against the new one.
 */
export function StaleCampaignPanel() {
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState<Row[]>([]);
  const [budgets, setBudgets] = useState<Array<{ property_id: string; campaign: string }>>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [m, b, p] = await Promise.all([
        supabase
          .from("daily_metrics")
          .select("property_id, campaign, cost")
          .eq("ad_source", "Google PPC")
          .gte("date", isoDaysAgo(60)),
        supabase.from("campaign_budgets").select("property_id, campaign"),
        supabase.from("properties").select("id, name"),
      ]);
      setMetrics((m.data ?? []) as Row[]);
      setBudgets((b.data ?? []) as Array<{ property_id: string; campaign: string }>);
      setNames(new Map(((p.data ?? []) as Array<{ id: string; name: string }>).map((r) => [r.id, r.name])));
      setLoading(false);
    })();
  }, []);

  const orphans = useMemo(() => findOrphanCampaigns(metrics, budgets), [metrics, budgets]);

  return (
    <section className="rounded-xl border border-border bg-card p-5 space-y-3">
      <div>
        <h2 className="text-sm font-semibold">Renamed or removed campaigns</h2>
        <p className="text-xs text-muted-foreground">
          Spend recorded in the last 60 days under a campaign name Google no longer reports. Usually a
          rename — the old line keeps counting alongside the new one until the two are merged.
        </p>
      </div>
      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking…
        </div>
      ) : orphans.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nothing to review — every campaign with spend still exists in Google Ads.</p>
      ) : (
        <ul className="space-y-2">
          {orphans.map((o) => (
            <li
              key={`${o.propertyId}-${o.campaign}`}
              className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs"
            >
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
              <span>
                <span className="font-medium">{names.get(o.propertyId) ?? "Unknown location"}</span> — “{o.campaign}”
                carries {fmtUSD(o.cost)} of spend but is not in the current campaign list.
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default StaleCampaignPanel;
