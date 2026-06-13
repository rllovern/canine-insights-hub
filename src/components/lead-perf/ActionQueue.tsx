import { useEffect, useMemo, useState } from "react";
import { ExternalLink, ArrowRight } from "lucide-react";
import { formatDistanceToNowStrict } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DrillIssue } from "@/lib/leadPerf";

type Row = {
  property_id: string;
  property_name: string | null;
  contact_id: string | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  agent_name: string | null;
  agent_is_default: boolean | null;
  lead_created_at: string | null;
  stage_name: string | null;
  canonical_stage: string | null;
  last_activity_at: string | null;
  last_activity_type: string | null;
  ghl_deep_link: string | null;
  reason: string | null;
  tag_names: string[] | null;
};

type TabDef = {
  id: DrillIssue;
  label: string;
  empty: string;
  showStage?: boolean;
};

const TABS: TabDef[] = [
  { id: "never_responded", label: "Needs First Response", empty: "Every lead in the window has a human response. Nice." },
  { id: "critical_stale",  label: "Critical Stale",       empty: "No critical-stale leads. Stay sharp.", showStage: true },
  { id: "unassigned",      label: "Unassigned",           empty: "Every lead has an owner.", showStage: true },
  { id: "disqualified_by_tag", label: "Disqualified (tag)", empty: "No leads disqualified by tag in this window.", showStage: true },
];

const MAX_INLINE = 8;

function formatPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`;
  if (digits.length === 11 && digits.startsWith("1")) {
    return `(${digits.slice(1,4)}) ${digits.slice(4,7)}-${digits.slice(7)}`;
  }
  return raw;
}

function leadIdentity(r: Row): string {
  if (r.contact_name && r.contact_name.trim()) return r.contact_name.trim();
  const phone = formatPhone(r.phone);
  if (phone) return phone;
  if (r.email) return r.email;
  if (r.contact_id) return `Contact ${r.contact_id.slice(0, 6)}…`;
  return "Unknown Lead";
}

export function ActionQueue({
  propertyIds, from, to, onDrill,
}: {
  propertyIds: string[] | null;
  from: Date;
  to: Date;
  onDrill: (issue: DrillIssue) => void;
}) {
  const [active, setActive] = useState<DrillIssue>("never_responded");
  const [cache, setCache] = useState<Record<string, Row[] | undefined>>({});
  const [loadingTab, setLoadingTab] = useState<DrillIssue | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});

  // Reset cache when scope/window changes
  useEffect(() => { setCache({}); setCounts({}); }, [propertyIds, from, to]);

  // Fetch active tab
  useEffect(() => {
    if (cache[active] !== undefined) return;
    setLoadingTab(active);
    (async () => {
      const { data } = await supabase.rpc("lead_perf_drill", {
        _issue_type: active,
        _property_ids: propertyIds,
        _from: from.toISOString(),
        _to: to.toISOString(),
        _limit: 200,
      });
      const rows = (data ?? []) as unknown as Row[];
      // sort by oldest first
      rows.sort((a, b) => {
        const aT = a.lead_created_at ? new Date(a.lead_created_at).getTime() : 0;
        const bT = b.lead_created_at ? new Date(b.lead_created_at).getTime() : 0;
        return aT - bT;
      });
      setCache(c => ({ ...c, [active]: rows }));
      setCounts(c => ({ ...c, [active]: rows.length }));
      setLoadingTab(null);
    })();
  }, [active, cache, propertyIds, from, to]);

  const def = TABS.find(t => t.id === active)!;
  const rows = cache[active];
  const visible = useMemo(() => rows?.slice(0, MAX_INLINE) ?? [], [rows]);

  return (
    <section className="rounded-xl border bg-card">
      <header className="flex items-center justify-between gap-3 border-b px-3 py-2">
        <div className="flex items-center gap-1 overflow-x-auto">
          {TABS.map(t => {
            const n = counts[t.id];
            const isActive = active === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setActive(t.id)}
                className={cn(
                  "px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors",
                  isActive ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted",
                )}
              >
                {t.label}
                {n !== undefined && (
                  <span className={cn("ml-1.5 tabular-nums",
                    isActive ? "opacity-80" : "text-muted-foreground/80",
                  )}>{n}</span>
                )}
              </button>
            );
          })}
        </div>
        <div className="text-[10.5px] uppercase tracking-wider text-muted-foreground hidden sm:block">Action Queue · oldest first</div>
      </header>

      <div className="overflow-x-auto">
        {loadingTab === active ? (
          <div className="p-3 space-y-2">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-7 w-full" />)}
          </div>
        ) : visible.length === 0 ? (
          <div className="px-4 py-6 text-sm text-muted-foreground">{def.empty}</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-[10.5px] uppercase tracking-wide text-muted-foreground">
              <tr className="border-b">
                <th className="text-left font-medium px-3 py-1.5">Lead</th>
                <th className="text-left font-medium px-3 py-1.5 hidden md:table-cell">Agent</th>
                {def.showStage && <th className="text-left font-medium px-3 py-1.5 hidden lg:table-cell">Stage</th>}
                <th className="text-left font-medium px-3 py-1.5">Age</th>
                <th className="text-left font-medium px-3 py-1.5 hidden md:table-cell">Last activity</th>
                <th className="text-left font-medium px-3 py-1.5 hidden lg:table-cell">Tags</th>
                <th className="text-left font-medium px-3 py-1.5 hidden xl:table-cell">Reason</th>
                <th className="px-3 py-1.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r, i) => {
                const created = r.lead_created_at ? new Date(r.lead_created_at) : null;
                const last = r.last_activity_at ? new Date(r.last_activity_at) : null;
                return (
                  <tr key={(r.contact_id ?? "x") + i} className="border-b last:border-0 hover:bg-muted/40">
                    <td className="px-3 py-1.5 max-w-[200px]">
                      <div className="truncate font-medium">{leadIdentity(r)}</div>
                      {r.property_name && (propertyIds === null || (propertyIds?.length ?? 0) > 1) && (
                        <div className="text-[10.5px] text-muted-foreground truncate">{r.property_name}</div>
                      )}
                    </td>
                    <td className="px-3 py-1.5 hidden md:table-cell text-muted-foreground truncate max-w-[140px]">
                      {r.agent_name ? (
                        <span>
                          {r.agent_name}
                          {r.agent_is_default && (
                            <span className="ml-1 text-[10px] text-muted-foreground/70">(default)</span>
                          )}
                        </span>
                      ) : (
                        <span className="italic text-muted-foreground/60">unassigned</span>
                      )}
                    </td>
                    {def.showStage && (
                      <td className="px-3 py-1.5 hidden lg:table-cell text-muted-foreground truncate max-w-[140px]">
                        {r.stage_name ?? r.canonical_stage ?? "—"}
                      </td>
                    )}
                    <td className="px-3 py-1.5 tabular-nums whitespace-nowrap">
                      {created ? formatDistanceToNowStrict(created, { addSuffix: false }) : "—"}
                    </td>
                    <td className="px-3 py-1.5 hidden md:table-cell text-muted-foreground tabular-nums whitespace-nowrap">
                      {last ? (
                        <span>
                          {formatDistanceToNowStrict(last, { addSuffix: true })}
                          {r.last_activity_type && (
                            <span className="ml-1 text-muted-foreground/70">· {r.last_activity_type}</span>
                          )}
                        </span>
                      ) : (
                        <span className="italic text-muted-foreground/60">—</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 hidden lg:table-cell max-w-[200px]">
                      {r.tag_names && r.tag_names.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {r.tag_names.slice(0, 3).map((t) => (
                            <span
                              key={t}
                              className="inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-foreground/80 max-w-[120px] truncate"
                              title={t}
                            >
                              {t}
                            </span>
                          ))}
                          {r.tag_names.length > 3 && (
                            <span className="text-[10px] text-muted-foreground">+{r.tag_names.length - 3}</span>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 hidden xl:table-cell text-muted-foreground max-w-[260px]">
                      <span className="truncate block" title={r.reason ?? undefined}>{r.reason ?? "—"}</span>
                    </td>
                    <td className="px-3 py-1.5 text-right whitespace-nowrap">
                      {r.ghl_deep_link ? (
                        <a
                          href={r.ghl_deep_link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                        >
                          Open in GHL <ExternalLink className="size-3" />
                        </a>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {(rows?.length ?? 0) > MAX_INLINE && (
        <footer className="border-t px-3 py-2 flex justify-end">
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs gap-1" onClick={() => onDrill(active)}>
            View all {rows!.length} <ArrowRight className="size-3" />
          </Button>
        </footer>
      )}
    </section>
  );
}