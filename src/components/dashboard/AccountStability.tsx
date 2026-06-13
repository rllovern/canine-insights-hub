import { useEffect, useMemo, useState } from "react";
import { ChartCard } from "./ChartCard";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Info } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatDistanceToNow, format, addDays, differenceInDays } from "date-fns";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

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

type Impact = "high" | "medium" | "low";

type Classified = ChangeEvent & {
  impact: Impact;
  windowDays: number; // 0 = no countdown
  reason: string;
};

function prettyResource(s?: string) {
  if (!s) return "";
  return s.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function fieldsOf(e: ChangeEvent): string[] {
  return (e.changed_fields ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

function classify(e: ChangeEvent): Classified {
  const rt = (e.resource_type ?? "").toUpperCase();
  const op = (e.operation ?? "").toUpperCase();
  const fields = fieldsOf(e).map((f) => f.toLowerCase());
  const has = (...needles: string[]) => fields.some((f) => needles.some((n) => f.includes(n)));

  // HIGH
  if (rt === "CAMPAIGN" && op === "CREATE") return mk("high", 14, "Campaign created");
  if (rt === "CAMPAIGN" && has("bidding_strategy", "bidding_strategy_type", "manual_cpc", "maximize_conversions", "target_cpa", "target_roas")) {
    if (has("target_cpa", "target_roas")) return mk("high", 14, "Target CPA/ROAS changed");
    return mk("high", 14, "Bid strategy changed");
  }
  if (rt === "CAMPAIGN_BUDGET" || (rt === "CAMPAIGN" && has("budget", "amount_micros"))) {
    return mk("high", 10, "Campaign budget changed");
  }
  if (rt === "CONVERSION_ACTION" || has("conversion_goal", "conversion_action", "selective_optimization")) {
    return mk("high", 14, "Conversion goal/action changed");
  }
  if ((rt === "ASSET_GROUP" || rt === "AD_GROUP") && op === "CREATE") {
    return mk("high", 7, `${prettyResource(rt)} created`);
  }
  if (rt === "CAMPAIGN" && has("status")) return mk("high", 7, "Campaign status changed");

  // MEDIUM
  if (rt === "CAMPAIGN_CRITERION" || rt === "AD_GROUP_CRITERION") {
    return mk("medium", 5, `${prettyResource(rt)} ${op.toLowerCase()}`);
  }
  if (has("location", "geo_target", "proximity")) return mk("medium", 5, "Location targeting changed");
  if (has("audience", "user_list")) return mk("medium", 5, "Audience signal changed");
  if (rt === "AD" || rt === "ASSET" || has("final_url", "final_urls", "tracking_url")) {
    return mk("medium", 4, has("final_url", "final_urls") ? "Landing page changed" : "Ad/asset changed");
  }

  // LOW
  if (has("name") || has("label")) return mk("low", 0, "Name/label change");
  return mk("low", 0, `${prettyResource(rt) || "Change"} ${op.toLowerCase()}`);

  function mk(impact: Impact, windowDays: number, reason: string): Classified {
    return { ...e, impact, windowDays, reason };
  }
}

function impactTone(i: Impact): "default" | "secondary" | "destructive" | "outline" {
  if (i === "high") return "destructive";
  if (i === "medium") return "secondary";
  return "outline";
}

function StatCard({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3 min-w-0">
      <div className="text-[10.5px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-semibold text-foreground truncate">{value}</div>
      {sub && <div className="mt-1 text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

export function AccountStability({ propertyId }: { propertyId: string }) {
  const [events, setEvents] = useState<ChangeEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null); setEvents(null);
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke("google-ads-change-history", {
          body: { property_id: propertyId, days: 30, limit: 500 },
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

  const classified = useMemo(() => (events ?? []).map(classify), [events]);

  const lastMajor = useMemo(() => {
    return classified.find((c) => c.impact === "high")
      ?? classified.find((c) => c.impact === "medium")
      ?? null;
  }, [classified]);

  // Campaign-level rollup: keep most impactful + most recent per campaign
  const perCampaign = useMemo(() => {
    const map = new Map<string, Classified & { campaignKey: string }>();
    const rank: Record<Impact, number> = { high: 3, medium: 2, low: 1 };
    for (const c of classified) {
      const key = c.campaign_id ?? c.campaign_name ?? "(account-level)";
      const prev = map.get(key);
      if (!prev) { map.set(key, { ...c, campaignKey: key }); continue; }
      const better =
        rank[c.impact] > rank[prev.impact]
        || (rank[c.impact] === rank[prev.impact] && new Date(c.change_date_time) > new Date(prev.change_date_time));
      if (better) map.set(key, { ...c, campaignKey: key });
    }
    return Array.from(map.values()).sort((a, b) => {
      const r = rank[b.impact] - rank[a.impact];
      if (r !== 0) return r;
      return new Date(b.change_date_time).getTime() - new Date(a.change_date_time).getTime();
    });
  }, [classified]);

  const now = new Date();
  const stabilizing = useMemo(() => {
    return perCampaign.filter((c) => c.windowDays > 0 && daysLeft(c, now) > 0);
  }, [perCampaign]);

  const impactedCount = stabilizing.length;
  const accountDaysLeft = stabilizing.reduce((m, c) => Math.max(m, daysLeft(c, now)), 0);
  const reviewDate = lastMajor ? addDays(new Date(lastMajor.change_date_time), lastMajor.windowDays || 7) : null;
  const status = accountDaysLeft > 0 ? "Stabilizing" : "Stable";

  return (
    <ChartCard
      title="Account Stability"
      subtitle={
        <>
          Status: <span className={status === "Stabilizing" ? "text-foreground font-medium" : "text-foreground font-medium"}>{status}</span>
          {" · "}Last major change: {lastMajor ? formatDistanceToNow(new Date(lastMajor.change_date_time), { addSuffix: true }) : "—"}
          {reviewDate && <> · Next optimization review: {format(reviewDate, "MMM d")}</>}
        </> as any
      }
      right={
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <button className="text-muted-foreground hover:text-foreground" aria-label="About stabilization">
                <Info className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs">
              This is an internal stabilization estimate based on recent structural account changes. It is not necessarily an official Google Ads learning status.
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      }
    >
      {loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
      )}
      {error && <div className="p-2 text-xs text-destructive">Could not load stability: {error}</div>}
      {!loading && !error && events && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            <StatCard
              label="Last Major Change"
              value={lastMajor ? formatDistanceToNow(new Date(lastMajor.change_date_time), { addSuffix: true }) : "None in 30 days"}
              sub={lastMajor ? (
                <>
                  <div className="truncate">{lastMajor.reason}</div>
                  <div className="truncate">{lastMajor.campaign_name ?? "Account-level"}</div>
                  {lastMajor.user_email && <div className="truncate">{lastMajor.user_email}</div>}
                </>
              ) : "Account is quiet"}
            />
            <StatCard
              label="Days Left in Stabilization"
              value={accountDaysLeft > 0 ? `${accountDaysLeft} days left` : "—"}
              sub={accountDaysLeft > 0 && lastMajor
                ? `Day ${Math.max(1, (lastMajor.windowDays || 7) - accountDaysLeft + 1)} of ${lastMajor.windowDays || 7}`
                : "No active stabilization"}
            />
            <StatCard
              label="Next Optimization Review"
              value={reviewDate ? format(reviewDate, "MMM d") : "—"}
              sub="Avoid major edits unless performance is severely broken"
            />
            <StatCard
              label="Impacted Campaigns"
              value={impactedCount}
              sub={impactedCount > 0
                ? stabilizing.slice(0, 3).map((c) => c.campaign_name ?? c.campaignKey).join(", ")
                : "No campaigns currently stabilizing"}
            />
          </div>

          <div className="mt-4 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Campaign</TableHead>
                  <TableHead>Last Major Change</TableHead>
                  <TableHead>Change Type</TableHead>
                  <TableHead>Impact</TableHead>
                  <TableHead>Days Left</TableHead>
                  <TableHead>Next Review</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {perCampaign.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="text-center text-xs text-muted-foreground py-6">No changes in the last 30 days.</TableCell></TableRow>
                )}
                {perCampaign.map((c) => {
                  const dl = c.windowDays > 0 ? daysLeft(c, now) : 0;
                  const review = c.windowDays > 0 ? addDays(new Date(c.change_date_time), c.windowDays) : null;
                  return (
                    <TableRow key={c.campaignKey}>
                      <TableCell className="text-xs font-medium truncate max-w-[220px]">{c.campaign_name ?? c.campaignKey}</TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{formatDistanceToNow(new Date(c.change_date_time), { addSuffix: true })}</TableCell>
                      <TableCell className="text-xs truncate max-w-[220px]">{c.reason}</TableCell>
                      <TableCell><Badge variant={impactTone(c.impact)} className="h-5 text-[10px] uppercase">{c.impact}</Badge></TableCell>
                      <TableCell className="text-xs tabular-nums">{c.windowDays === 0 ? "—" : dl > 0 ? `${dl} days` : "Done"}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap">{review ? format(review, "MMM d") : "—"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </ChartCard>
  );
}

function daysLeft(c: Classified, now: Date): number {
  if (c.windowDays <= 0) return 0;
  const end = addDays(new Date(c.change_date_time), c.windowDays);
  return Math.max(0, differenceInDays(end, now));
}