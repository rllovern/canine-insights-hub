import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { formatDistanceToNow } from "date-fns";
import { toast } from "@/hooks/use-toast";

interface SyncRun {
  id: string;
  property_id: string;
  source: string;
  status: string;
  error_message: string | null;
  finished_at: string;
  acknowledged_at: string | null;
}
interface PropertyLite { id: string; name: string }

export function SyncHealthBell() {
  const [failures, setFailures] = useState<SyncRun[]>([]);
  const [clients, setClients] = useState<Record<string, string>>({});
  const [open, setOpen] = useState(false);

  const load = async () => {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data } = await supabase
      .from("sync_runs")
      .select("id,property_id,source,status,error_message,finished_at,acknowledged_at")
      .eq("status", "failure")
      .is("acknowledged_at", null)
      .gte("finished_at", since)
      .order("finished_at", { ascending: false })
      .limit(50);
    const rows = (data ?? []) as SyncRun[];
    setFailures(rows);

    const ids = Array.from(new Set(rows.map((r) => r.property_id)));
    if (ids.length) {
      const { data: cs } = await supabase.from("properties").select("id,name").in("id", ids);
      const map: Record<string, string> = {};
      for (const c of (cs ?? []) as PropertyLite[]) map[c.id] = c.name;
      setClients(map);
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);

  const dismissAll = async () => {
    if (failures.length === 0) return;
    const ids = failures.map((f) => f.id);
    const { error } = await supabase
      .from("sync_runs")
      .update({ acknowledged_at: new Date().toISOString() })
      .in("id", ids);
    if (error) {
      toast({ title: "Failed to dismiss", description: error.message, variant: "destructive" });
      return;
    }
    setFailures([]);
    setOpen(false);
    toast({ title: "Alerts dismissed" });
  };

  const count = failures.length;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="icon" className="h-9 w-9 relative" aria-label="Sync health">
          <Bell className="size-4" />
          {count > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-semibold grid place-items-center">
              {count > 99 ? "99+" : count}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0 z-50 bg-popover" sideOffset={6}>
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div>
            <div className="text-sm font-semibold">Sync health</div>
            <div className="text-xs text-muted-foreground">
              {count === 0 ? "All systems healthy" : `${count} failure${count === 1 ? "" : "s"} in last 24h`}
            </div>
          </div>
          {count > 0 && (
            <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={dismissAll}>
              Dismiss all
            </Button>
          )}
        </div>
        <div className="max-h-96 overflow-y-auto">
          {count === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-muted-foreground">
              No sync failures. Data refreshes every 12 hours.
            </div>
          ) : (
            failures.map((f) => (
              <div key={f.id} className="px-4 py-3 border-b last:border-0">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-medium truncate">
                    {clients[f.property_id] ?? "Unknown client"}
                  </div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground shrink-0">
                    {f.source.replace("_", " ")}
                  </div>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {formatDistanceToNow(new Date(f.finished_at), { addSuffix: true })}
                </div>
                {f.error_message && (
                  <div className="text-xs text-destructive/90 mt-1 line-clamp-3 break-words">
                    {f.error_message}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
