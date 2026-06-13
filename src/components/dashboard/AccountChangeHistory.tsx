import { useEffect, useMemo, useState } from "react";
import { ChartCard } from "./ChartCard";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { formatDistanceToNow } from "date-fns";

type ChangeEvent = {
  change_date_time: string;
  user_email?: string;
  client_type?: string;
  resource_type?: string;
  resource_name?: string;
  operation?: string;
  changed_fields?: string;
  campaign_id?: string;
  campaign_name?: string;
  ad_group_id?: string;
  ad_group_name?: string;
};

function prettyResource(s?: string) {
  if (!s) return "";
  return s.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function opTone(op?: string): "default" | "secondary" | "destructive" | "outline" {
  if (op === "CREATE") return "default";
  if (op === "REMOVE") return "destructive";
  if (op === "UPDATE") return "secondary";
  return "outline";
}

export function AccountChangeHistory({ propertyId }: { propertyId: string }) {
  const [events, setEvents] = useState<ChangeEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setEvents(null);
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke("google-ads-change-history", {
          body: { property_id: propertyId, days: 30, limit: 200 },
        });
        if (cancelled) return;
        if (error) { setError(error.message); setLoading(false); return; }
        if ((data as any)?.error) { setError(String((data as any).error)); setLoading(false); return; }
        setEvents(((data as any)?.events ?? []) as ChangeEvent[]);
      } catch (e: any) {
        if (!cancelled) setError(String(e?.message ?? e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [propertyId]);

  const lastChangeLabel = useMemo(() => {
    if (!events?.length) return null;
    return formatDistanceToNow(new Date(events[0].change_date_time), { addSuffix: true });
  }, [events]);

  return (
    <ChartCard
      title="Account Change History"
      subtitle={lastChangeLabel ? `Last change ${lastChangeLabel} · Google Ads (last 30 days)` : "Google Ads (last 30 days)"}
    >
      <div className="max-h-[480px] overflow-auto -mx-2">
        {loading && <div className="space-y-2 p-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>}
        {error && <div className="p-3 text-xs text-destructive">Could not load change history: {error}</div>}
        {!loading && !error && events && events.length === 0 && (
          <div className="p-6 text-center text-xs text-muted-foreground">No changes recorded in the last 30 days.</div>
        )}
        {!loading && !error && events && events.length > 0 && (
          <ul className="divide-y divide-border">
            {events.map((e, i) => {
              const when = new Date(e.change_date_time);
              const target =
                e.ad_group_name ? `${e.campaign_name ?? "Campaign"} › ${e.ad_group_name}`
                : e.campaign_name ? e.campaign_name
                : e.ad_group_id ? `Ad group ${e.ad_group_id}`
                : e.campaign_id ? `Campaign ${e.campaign_id}`
                : prettyResource(e.resource_type);
              const fields = (e.changed_fields ?? "").split(",").map((s) => s.trim()).filter(Boolean);
              return (
                <li key={i} className="px-3 py-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Badge variant={opTone(e.operation)} className="h-5 text-[10px] uppercase tracking-wide">{e.operation ?? "—"}</Badge>
                      <span className="font-medium truncate">{prettyResource(e.resource_type)}</span>
                      <span className="text-muted-foreground truncate">· {target}</span>
                    </div>
                    <span className="text-muted-foreground whitespace-nowrap tabular-nums">{formatDistanceToNow(when, { addSuffix: true })}</span>
                  </div>
                  {fields.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {fields.slice(0, 6).map((f) => (
                        <span key={f} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{f}</span>
                      ))}
                      {fields.length > 6 && <span className="text-[10px] text-muted-foreground">+{fields.length - 6} more</span>}
                    </div>
                  )}
                  <div className="mt-0.5 text-[10.5px] text-muted-foreground">
                    {e.user_email ?? "unknown user"}
                    {e.client_type ? ` · ${prettyResource(e.client_type)}` : ""}
                    {" · "}
                    {when.toLocaleString()}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </ChartCard>
  );
}