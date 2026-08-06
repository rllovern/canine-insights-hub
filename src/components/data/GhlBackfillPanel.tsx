import { useEffect, useMemo, useState } from "react";
import { History, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type PropertyOption = { id: string; name: string };

type BackfillTotals = {
  contacts_imported?: number;
  opportunities_imported?: number;
  chunks_done?: number;
};

type BackfillResponse = {
  error?: string;
  phase?: string;
  totals?: BackfillTotals;
  lead_facts?: number;
  earliest_contact_created_at?: string | null;
  next?: (Record<string, unknown> & { phase?: string }) | null;
};

const MAX_CHUNKS = 60; // safety stop for the client-side chunk loop

const PHASE_LABELS: Record<string, string> = {
  contacts: "Importing contacts",
  opportunities: "Importing opportunities",
  finalize: "Rebuilding derived data",
};

function defaultStartDate() {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 2);
  return d.toISOString().slice(0, 10);
}

export function GhlBackfillPanel() {
  const [properties, setProperties] = useState<PropertyOption[]>([]);
  const [propertyId, setPropertyId] = useState<string>("");
  const [startDate, setStartDate] = useState<string>(defaultStartDate());
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState<string | null>(null);
  const [totals, setTotals] = useState<BackfillTotals>({});
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: sources } = await supabase
        .from("property_data_sources")
        .select("property_id")
        .eq("source", "ghl")
        .eq("is_connected", true);
      const ids = (sources ?? []).map((r) => r.property_id as string);
      if (ids.length === 0) return;
      const { data: props } = await supabase
        .from("properties")
        .select("id, name")
        .in("id", ids)
        .order("name");
      setProperties((props ?? []) as PropertyOption[]);
    })();
  }, []);

  const selectedName = useMemo(
    () => properties.find((p) => p.id === propertyId)?.name ?? "",
    [properties, propertyId],
  );

  const runBackfill = async () => {
    if (!propertyId) return;
    setRunning(true);
    setResult(null);
    setTotals({});
    setPhase("contacts");

    let payload: Record<string, unknown> = {
      property_id: propertyId,
      start_date: startDate,
      phase: "contacts",
    };

    try {
      for (let i = 0; i < MAX_CHUNKS; i++) {
        const { data, error } = await supabase.functions.invoke("ghl-backfill", { body: payload });
        if (error) throw new Error(error.message);
        const res = (data ?? {}) as BackfillResponse;
        if (res.error) throw new Error(res.error);

        if (res.totals) setTotals(res.totals);

        if (!res.next) {
          const earliest = res.earliest_contact_created_at
            ? new Date(res.earliest_contact_created_at).toLocaleDateString()
            : null;
          setPhase(null);
          setResult(
            `Backfill complete for ${selectedName}. ` +
            `${res.totals?.contacts_imported ?? 0} contacts and ${res.totals?.opportunities_imported ?? 0} opportunities imported` +
            (earliest ? `; history now reaches back to ${earliest}.` : "."),
          );
          toast.success(`Backfill complete for ${selectedName}`);
          setRunning(false);
          return;
        }

        setPhase(String(res.next.phase ?? ""));
        payload = { property_id: propertyId, start_date: startDate, ...res.next };
      }
      setPhase(null);
      setResult("Stopped after the maximum number of chunks — run it again to continue where it left off.");
      toast.warning("Backfill paused; run it again to continue.");
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setPhase(null);
      setResult(`Backfill failed: ${message}`);
      toast.error(`Backfill failed: ${message}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <History className="h-4 w-4 text-muted-foreground" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold">Historical backfill (Go High Level)</div>
          <div className="text-[11px] text-muted-foreground">
            Pull contacts and opportunities older than the rolling 30-day sync window. Safe to re-run — existing records are updated, not duplicated.
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3 px-4 py-3">
        <div className="min-w-[220px]">
          <Label className="text-[11px] text-muted-foreground">Property</Label>
          <Select value={propertyId} onValueChange={setPropertyId} disabled={running}>
            <SelectTrigger className="h-8 text-xs mt-1">
              <SelectValue placeholder="Select a property" />
            </SelectTrigger>
            <SelectContent>
              {properties.map((p) => (
                <SelectItem key={p.id} value={p.id} className="text-xs">{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="text-[11px] text-muted-foreground">Go back to</Label>
          <Input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            disabled={running}
            className="h-8 text-xs mt-1 w-[160px]"
          />
        </div>

        <Button size="sm" onClick={runBackfill} disabled={running || !propertyId}>
          {running
            ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Backfilling…</>
            : <><History className="h-3.5 w-3.5 mr-1.5" /> Run backfill</>}
        </Button>

        {running && (
          <div className="text-[11px] text-muted-foreground">
            {PHASE_LABELS[phase ?? ""] ?? "Working"} · chunk {totals.chunks_done ?? 0} ·{" "}
            {totals.contacts_imported ?? 0} contacts · {totals.opportunities_imported ?? 0} opportunities
          </div>
        )}
      </div>

      {result && (
        <div className="px-4 pb-3 text-[11px] text-muted-foreground">{result}</div>
      )}
    </div>
  );
}
