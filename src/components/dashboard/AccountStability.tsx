import { useEffect, useMemo, useState } from "react";
import { ChartCard } from "./ChartCard";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Info, Target, Image as ImageIcon, DollarSign, Gauge, Settings2, Crosshair, Users, Link2, CheckCircle2, AlertTriangle, Circle,
} from "lucide-react";
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
  windowDays: number;
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

  if (rt === "CAMPAIGN_CRITERION" || rt === "AD_GROUP_CRITERION") {
    return mk("medium", 5, `${prettyResource(rt)} ${op.toLowerCase()}`);
  }
  if (has("location", "geo_target", "proximity")) return mk("medium", 5, "Location targeting changed");
  if (has("audience", "user_list")) return mk("medium", 5, "Audience signal changed");
  if (rt === "AD" || rt === "ASSET" || has("final_url", "final_urls", "tracking_url")) {
    return mk("medium", 4, has("final_url", "final_urls") ? "Landing page changed" : "Ad/asset changed");
  }

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

function impactBarClass(i: Impact): string {
  if (i === "high") return "bg-destructive";
  if (i === "medium") return "bg-amber-500";
  return "bg-muted-foreground/50";
}

function impactDotClass(i: Impact): string {
  if (i === "high") return "bg-destructive";
  if (i === "medium") return "bg-amber-500";
  return "bg-muted-foreground/60";
}

function reasonIcon(reason: string) {
  const r = reason.toLowerCase();
  if (r.includes("budget")) return DollarSign;
  if (r.includes("bid") || r.includes("cpa") || r.includes("roas")) return Gauge;
  if (r.includes("conversion")) return CheckCircle2;
  if (r.includes("landing") || r.includes("url")) return Link2;
  if (r.includes("ad/asset") || r.includes("asset") || r.includes("ad ")) return ImageIcon;
  if (r.includes("audience")) return Users;
  if (r.includes("location") || r.includes("geo") || r.includes("targeting") || r.includes("criterion")) return Crosshair;
  if (r.includes("campaign created") || r.includes("status")) return Target;
  return Settings2;
}

function statusBadgeVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "High Risk Learning Reset") return "destructive";
  if (status === "Stabilizing") return "secondary";
  if (status === "Stable") return "default";
  return "outline";
}

function StatCard({ label, value, sub, children }: { label: string; value?: React.ReactNode; sub?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3 min-w-0">
      <div className="text-[10.5px] uppercase tracking-wide text-muted-foreground">{label}</div>
      {value !== undefined && <div className="mt-1 text-sm font-semibold text-foreground truncate">{value}</div>}
      {children}
      {sub && <div className="mt-1 text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function CountdownRing({ daysLeft, total, impact }: { daysLeft: number; total: number; impact: Impact }) {
  const size = 72;
  const stroke = 8;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = total > 0 ? Math.min(1, Math.max(0, (total - daysLeft) / total)) : 1;
  const offset = c * (1 - pct);
  const color = impact === "high" ? "hsl(var(--destructive))" : impact === "medium" ? "rgb(245 158 11)" : "hsl(var(--muted-foreground))";
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="hsl(var(--muted))" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2} cy={size / 2} r={r}
          stroke={color} strokeWidth={stroke} fill="none"
          strokeDasharray={c} strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 600ms ease" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-sm font-semibold leading-none">{total > 0 ? daysLeft : "—"}</div>
        <div className="text-[9px] uppercase tracking-wide text-muted-foreground mt-0.5">{total > 0 ? "days" : "done"}</div>
      </div>
    </div>
  );
}

function SeverityBars({ counts }: { counts: { high: number; medium: number; low: number } }) {
  const total = counts.high + counts.medium + counts.low || 1;
  return (
    <div className="space-y-1.5">
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className="bg-destructive" style={{ width: `${(counts.high / total) * 100}%` }} />
        <div className="bg-amber-500" style={{ width: `${(counts.medium / total) * 100}%` }} />
        <div className="bg-muted-foreground/50" style={{ width: `${(counts.low / total) * 100}%` }} />
      </div>
      <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-destructive" />HIGH {counts.high}</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" />MED {counts.medium}</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-muted-foreground/50" />LOW {counts.low}</span>
      </div>
    </div>
  );
}

function StatusTimeline({
  lastChangeAt, reviewDate, status,
}: { lastChangeAt: Date | null; reviewDate: Date | null; status: string }) {
  const now = new Date();
  const start = lastChangeAt ?? now;
  const end = reviewDate ?? addDays(start, 7);
  const totalMs = Math.max(1, end.getTime() - start.getTime());
  const pct = Math.min(100, Math.max(0, ((now.getTime() - start.getTime()) / totalMs) * 100));
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="relative h-2 rounded-full bg-muted mt-6">
        <div className="absolute inset-y-0 left-0 rounded-full bg-primary/70" style={{ width: `${pct}%` }} />
        <div className="absolute -top-1 left-0 h-4 w-4 -translate-x-1/2 rounded-full border-2 border-background bg-destructive">
          <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[9.5px] uppercase tracking-wide text-muted-foreground whitespace-nowrap">Change made</span>
        </div>
        <div
          className="absolute -top-1 h-4 w-4 -translate-x-1/2 rounded-full border-2 border-background bg-primary"
          style={{ left: `${pct}%` }}
        >
          <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[9.5px] uppercase tracking-wide text-foreground whitespace-nowrap">Now</span>
        </div>
        <div className="absolute -top-1 right-0 h-4 w-4 translate-x-1/2 rounded-full border-2 border-background bg-emerald-500">
          <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[9.5px] uppercase tracking-wide text-muted-foreground whitespace-nowrap">Review</span>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px]">
        <span className="text-foreground">{lastChangeAt ? format(lastChangeAt, "MMM d") : "—"}</span>
        <span className="text-muted-foreground">{status}</span>
        <span className="text-foreground">{reviewDate ? format(reviewDate, "MMM d") : "—"}</span>
      </div>
    </div>
  );
}

function ChangeSparkline({ events, days = 30 }: { events: Classified[]; days?: number }) {
  const now = new Date();
  const buckets = Array.from({ length: days }, (_, i) => {
    const day = addDays(now, -(days - 1 - i));
    return { day, high: 0, medium: 0, low: 0, total: 0 };
  });
  for (const e of events) {
    const d = new Date(e.change_date_time);
    const idx = days - 1 - differenceInDays(now, d);
    if (idx >= 0 && idx < days) {
      buckets[idx][e.impact] += 1;
      buckets[idx].total += 1;
    }
  }
  const totals = events.reduce(
    (acc, e) => { acc[e.impact] += 1; return acc; },
    { high: 0, medium: 0, low: 0 } as Record<Impact, number>,
  );
  const structural = totals.high + totals.medium;
  const max = Math.max(1, ...buckets.map((b) => b.total));
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
        <div className="text-[10.5px] uppercase tracking-wide text-muted-foreground">Change Activity · last {days} days</div>
        <div className="flex items-center gap-3 text-[10.5px] text-muted-foreground">
          <span><span className="text-foreground font-semibold">{events.length}</span> total</span>
          <span><span className="text-foreground font-semibold">{structural}</span> structural</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-destructive" />{totals.high} high</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" />{totals.medium} med</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-muted-foreground/50" />{totals.low} low/admin</span>
        </div>
      </div>
      <div className="flex items-end gap-[3px] h-14">
        {buckets.map((b, i) => {
          const h = b.total === 0 ? 4 : Math.max(12, (b.total / max) * 100);
          const top: Impact = b.high > 0 ? "high" : b.medium > 0 ? "medium" : "low";
          return (
            <div
              key={i}
              className="flex-1 flex items-end h-full"
              title={`${format(b.day, "MMM d")}: ${b.total} change${b.total === 1 ? "" : "s"} (H${b.high}/M${b.medium}/L${b.low})`}
            >
              <div
                className={`w-full rounded-sm ${b.total === 0 ? "bg-muted/50" : impactBarClass(top)}`}
                style={{ height: `${h}%`, opacity: b.total === 0 ? 0.6 : 1 }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-[9.5px] text-muted-foreground">
        <span>{format(buckets[0].day, "MMM d")}</span>
        <span>{format(buckets[buckets.length - 1].day, "MMM d")}</span>
      </div>
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

  const perCampaign = useMemo(() => {
    const map = new Map<string, Classified & { campaignKey: string }>();
    const rank: Record<Impact, number> = { high: 3, medium: 2, low: 1 };
    for (const c of classified) {
      const key = c.campaign_id ?? c.campaign_name ?? "Account-level change";
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
  const lastChangeAt = lastMajor ? new Date(lastMajor.change_date_time) : null;

  const severityCounts = useMemo(() => {
    const counts = { high: 0, medium: 0, low: 0 };
    for (const c of stabilizing) counts[c.impact] += 1;
    return counts;
  }, [stabilizing]);

  const status = useMemo(() => {
    if (!lastMajor || !events?.length) return "Ready for Optimization";
    const daysSince = differenceInDays(now, new Date(lastMajor.change_date_time));
    if (lastMajor.impact === "high" && daysSince < 3) return "High Risk Learning Reset";
    if (accountDaysLeft > 0) return "Stabilizing";
    return "Stable";
  }, [lastMajor, events, accountDaysLeft, now]);

  const windowTotal = lastMajor?.windowDays ?? 0;
  const currentDay = lastMajor && windowTotal > 0
    ? Math.max(1, Math.min(windowTotal, windowTotal - accountDaysLeft + 1))
    : 0;

  return (
    <ChartCard
      title="Account Stability"
      subtitle={
        <span>
          Last major change: {lastMajor ? formatDistanceToNow(new Date(lastMajor.change_date_time), { addSuffix: true }) : "—"}
          {reviewDate && <> · Next optimization review: {format(reviewDate, "MMM d")}</>}
        </span>
      }
      right={
        <div className="flex items-center gap-2">
          <Badge variant={statusBadgeVariant(status)} className="text-[10px] uppercase">{status}</Badge>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button className="text-muted-foreground hover:text-foreground" aria-label="About stabilization">
                  <Info className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs">
                This is an internal stabilization estimate based on recent structural Google Ads changes. It is not necessarily an official Google Ads learning status.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
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
          <div className="mb-3">
            <StatusTimeline lastChangeAt={lastChangeAt} reviewDate={reviewDate} status={status} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            <StatCard label="Last Major Change">
              {lastMajor ? (
                <div className="mt-1 flex items-start gap-2">
                  {(() => { const I = reasonIcon(lastMajor.reason); return <I className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />; })()}
                  <div className="min-w-0">
                    <div className="text-sm font-semibold truncate">{formatDistanceToNow(new Date(lastMajor.change_date_time), { addSuffix: true })}</div>
                    <div className="text-[11px] text-muted-foreground truncate">{lastMajor.reason}</div>
                    <div className="text-[10.5px] text-muted-foreground truncate">{lastMajor.campaign_name ?? "Account-level change"}</div>
                  </div>
                </div>
              ) : (
                <div className="mt-1 text-sm font-semibold">None in 30 days</div>
              )}
            </StatCard>

            <StatCard label="Stabilization Countdown">
              <div className="mt-1 flex items-center gap-3">
                <CountdownRing daysLeft={accountDaysLeft} total={windowTotal} impact={lastMajor?.impact ?? "low"} />
                <div className="min-w-0">
                  <div className="text-sm font-semibold">
                    {accountDaysLeft > 0 ? `${accountDaysLeft} days remaining` : "No active window"}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {windowTotal > 0 ? `${windowTotal}-day window` : "—"}
                    {lastMajor && <> · {capitalize(lastMajor.impact)} impact</>}
                  </div>
                  {lastMajor && windowTotal > 0 && (
                    <div className="text-[10.5px] text-muted-foreground">
                      Started {format(new Date(lastMajor.change_date_time), "MMM d")}
                      {reviewDate && <> · Review {format(reviewDate, "MMM d")}</>}
                    </div>
                  )}
                </div>
              </div>
            </StatCard>

            <StatCard
              label="Next Optimization Review"
              value={reviewDate ? format(reviewDate, "MMM d") : "—"}
              sub={reviewDate
                ? <>In {Math.max(0, differenceInDays(reviewDate, now))} days · hold structural edits</>
                : "No upcoming review"}
            />

            <StatCard label="Impacted Campaigns">
              <div className="mt-1 flex items-baseline gap-2">
                <div className="text-lg font-semibold leading-none">{impactedCount}</div>
                <div className="text-[11px] text-muted-foreground">affected</div>
              </div>
              <div className="mt-2">
                <SeverityBars counts={severityCounts} />
              </div>
            </StatCard>
          </div>

          <div className="mt-3">
            <ChangeSparkline events={classified} days={30} />
          </div>

          <div className="mt-4 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Campaign / Scope</TableHead>
                  <TableHead>Last Major Change</TableHead>
                  <TableHead>Change Type</TableHead>
                  <TableHead>Impact</TableHead>
                  <TableHead className="w-[180px]">Stabilization</TableHead>
                  <TableHead>Next Review</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {perCampaign.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="text-center text-xs text-muted-foreground py-6">No changes in the last 30 days.</TableCell></TableRow>
                )}
                {perCampaign.map((c, idx) => {
                  const dl = c.windowDays > 0 ? daysLeft(c, now) : 0;
                  const review = c.windowDays > 0 ? addDays(new Date(c.change_date_time), c.windowDays) : null;
                  const pct = c.windowDays > 0 ? Math.min(100, Math.max(0, ((c.windowDays - dl) / c.windowDays) * 100)) : 100;
                  const Icon = reasonIcon(c.reason);
                  return (
                    <TableRow key={c.campaignKey} className={idx % 2 === 1 ? "bg-muted/30" : ""}>
                      <TableCell className="text-xs font-medium truncate max-w-[220px]">
                        <span className="inline-flex items-center gap-1.5">
                          <span className={`h-1.5 w-1.5 rounded-full ${impactDotClass(c.impact)}`} />
                          {c.campaign_name ?? c.campaignKey}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{formatDistanceToNow(new Date(c.change_date_time), { addSuffix: true })}</TableCell>
                      <TableCell className="text-xs truncate max-w-[220px]">
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex items-center gap-1.5 cursor-help">
                                <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                                {c.reason}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs text-xs">
                              {reasonTooltip(c.reason)}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </TableCell>
                      <TableCell><Badge variant={impactTone(c.impact)} className="h-5 text-[10px] uppercase">{c.impact}</Badge></TableCell>
                      <TableCell className="text-xs">
                        {c.windowDays === 0 ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-24 rounded-full bg-muted overflow-hidden">
                              <div className={`h-full ${impactBarClass(c.impact)}`} style={{ width: `${pct}%` }} />
                            </div>
                            <span className="tabular-nums text-[11px] text-muted-foreground whitespace-nowrap">
                              {dl > 0 ? `${dl}d left` : "Done"}
                            </span>
                          </div>
                        )}
                      </TableCell>
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

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}