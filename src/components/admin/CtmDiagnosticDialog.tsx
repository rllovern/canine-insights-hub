import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "@/hooks/use-toast";

/**
 * Runs `sync-ctm` with `debug: true` against the client's CTM connection
 * and surfaces what CTM is actually returning so admins can build score mappings
 * and see why data may not be flowing.
 *
 * No data is written during a debug run.
 */

interface Property {
  id: string;
  name: string;
}

interface DebugResult {
  total_calls: number;
  range: { from: string; to: string };
  distinct_scores: string[];
  distinct_sources: [string, number][];
  distinct_score_labels: [string, number][];
  tag_usage: [string, number][];
  list_top_level_keys: string[];
  picked_call_ids: string[];
  full_details?: any[];
  error?: string;
}

function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

export function CtmDiagnosticDialog({
  client,
  onClose,
}: {
  client: Property | null;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DebugResult | null>(null);

  const run = async () => {
    if (!client) return;
    setLoading(true);
    setResult(null);
    const { data, error } = await supabase.functions.invoke("sync-ctm", {
      body: {
        property_id: client.id,
        date_from: isoDaysAgo(30),
        date_to: isoDaysAgo(1),
        debug: true,
      },
    });
    setLoading(false);
    if (error || (data as any)?.error) {
      toast({
        title: "Diagnostic failed",
        description: String(error?.message ?? (data as any)?.error ?? "Unknown error"),
        variant: "destructive",
      });
      return;
    }
    setResult(data as DebugResult);
  };

  useEffect(() => {
    if (client) run();
    else setResult(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  if (!client) return null;

  return (
    <Dialog open={!!client} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>CTM diagnostic — {client.name}</DialogTitle>
          <DialogDescription>
            Inspects what CallTrackingMetrics is returning for this client over the last 30 days. No data is written.
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="py-12 grid place-items-center text-muted-foreground">
            <Loader2 className="size-6 animate-spin" />
            <span className="text-xs mt-2">Querying CTM…</span>
          </div>
        )}

        {result && !loading && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3">
              <StatCard label="Total calls" value={String(result.total_calls)} />
              <StatCard label="Date range" value={`${result.range.from} → ${result.range.to}`} />
            </div>

            <Section title="Sources (CTM `source` field)" hint="These are the source-name strings CTM is returning. Anything not 'Google Ads', 'Facebook', etc. now lands as 'Other' — but you can confirm here what CTM is actually using.">
              <KeyValueTable rows={result.distinct_sources} emptyHint="No calls returned, so no sources to show." />
            </Section>

            <Section title="Score labels found" hint="These are the values you should map in Score Mappings. Each unmapped label currently falls into 'No Entry'.">
              <KeyValueTable rows={result.distinct_score_labels} emptyHint="No score labels found on any call." />
            </Section>

            <Section title="Tag usage" hint="Other tags attached to calls (CTM `tag_list` and `tags`). Useful for spotting alternate label fields.">
              <KeyValueTable rows={result.tag_usage} emptyHint="No tags found." />
            </Section>

            {result.distinct_scores.length > 0 && (
              <Section title="Legacy `score` field" hint="Some accounts also set a top-level `score`.">
                <div className="text-sm font-mono">{result.distinct_scores.join(", ")}</div>
              </Section>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={run} disabled={loading}>
            {loading ? <Loader2 className="size-4 mr-1.5 animate-spin" /> : <RefreshCw className="size-4 mr-1.5" />}
            Re-run
          </Button>
          <Button onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-border rounded-lg p-3 bg-muted/20">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold mt-1 font-mono">{value}</div>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <h3 className="text-sm font-semibold">{title}</h3>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
      <div className="border border-border rounded-lg overflow-hidden">{children}</div>
    </div>
  );
}

function KeyValueTable({ rows, emptyHint }: { rows: [string, number][]; emptyHint: string }) {
  if (!rows || rows.length === 0) {
    return <div className="text-xs text-muted-foreground p-3">{emptyHint}</div>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow className="bg-muted/40">
          <TableHead>Value</TableHead>
          <TableHead className="w-24 text-right">Count</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(([k, v]) => (
          <TableRow key={k}>
            <TableCell className="font-mono text-xs">{k}</TableCell>
            <TableCell className="text-right font-mono text-xs">{v}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
