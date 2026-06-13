import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/data/PageHeader";
import { EmptyState } from "@/components/data/EmptyState";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useProperties } from "@/contexts/PropertyContext";
import { ReportView } from "@/components/jarvis/report/ReportView";
import type { ReportSchema } from "@/lib/jarvis/reportSchema";
import { isReportSchema } from "@/lib/jarvis/reportSchema";
import { Star, ExternalLink, Trash2, MessageSquare } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { AskJarvisButton } from "@/components/jarvis/AskJarvisButton";

type ReportRow = {
  id: string;
  session_id: string | null;
  property_id: string | null;
  report_type: string;
  title: string;
  date_range_start: string | null;
  date_range_end: string | null;
  schema_json: unknown;
  saved: boolean;
  saved_at: string | null;
  created_at: string;
};

const REPORT_TYPE_LABEL: Record<string, string> = {
  ctm_ghl_reconciliation: "CTM ↔ GHL reconciliation",
  performance_comparison: "Performance comparison",
  lead_performance: "Lead performance",
  account_stability: "Account stability",
  data_quality_audit: "Data quality audit",
  client_summary: "Client summary",
};

function typeLabel(t: string) {
  return REPORT_TYPE_LABEL[t] ?? t.replace(/_/g, " ");
}

export default function Reports() {
  const { user } = useAuth();
  const { properties } = useProperties();
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [type, setType] = useState<string>("all");
  const [propertyId, setPropertyId] = useState<string>("all");
  const [savedOnly, setSavedOnly] = useState(false);
  const [open, setOpen] = useState<ReportRow | null>(null);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("ai_agent_reports")
      .select("id,session_id,property_id,report_type,title,date_range_start,date_range_end,schema_json,saved,saved_at,created_at")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) {
      console.error("[Reports] load failed", error);
      toast({ title: "Failed to load reports", description: error.message });
      setRows([]);
    } else {
      setRows((data ?? []) as ReportRow[]);
    }
    setLoading(false);
  };

  useEffect(() => { void load(); }, [user?.id]);

  const propertyName = (id: string | null) =>
    properties.find((p) => p.id === id)?.name ?? "—";

  const types = useMemo(
    () => Array.from(new Set(rows.map((r) => r.report_type))).sort(),
    [rows]
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (savedOnly && !r.saved) return false;
      if (type !== "all" && r.report_type !== type) return false;
      if (propertyId !== "all" && r.property_id !== propertyId) return false;
      if (needle && !`${r.title} ${typeLabel(r.report_type)} ${propertyName(r.property_id)}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [rows, q, type, propertyId, savedOnly, properties]);

  const toggleSaved = async (r: ReportRow) => {
    const next = !r.saved;
    const { error } = await supabase
      .from("ai_agent_reports")
      .update({ saved: next })
      .eq("id", r.id);
    if (error) { toast({ title: "Update failed", description: error.message }); return; }
    setRows((rs) => rs.map((x) => x.id === r.id ? { ...x, saved: next, saved_at: next ? new Date().toISOString() : null } : x));
  };

  const softDelete = async (r: ReportRow) => {
    const { error } = await supabase
      .from("ai_agent_reports")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", r.id);
    if (error) { toast({ title: "Delete failed", description: error.message }); return; }
    setRows((rs) => rs.filter((x) => x.id !== r.id));
    if (open?.id === r.id) setOpen(null);
    toast({ title: "Report deleted" });
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <PageHeader
        title="Reports"
        description="Saved Jarvis reports and recent runs."
        actions={
          <AskJarvisButton
            prompt="Generate a fresh report for the active property. Ask me what kind if it's ambiguous."
            label="New report with Jarvis"
            variant="default"
          />
        }
      />

      <Card className="p-3">
        <div className="flex flex-wrap gap-2 items-center">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search reports…"
            className="w-56"
          />
          <Select value={type} onValueChange={setType}>
            <SelectTrigger className="w-56"><SelectValue placeholder="Type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {types.map((t) => <SelectItem key={t} value={t}>{typeLabel(t)}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={propertyId} onValueChange={setPropertyId}>
            <SelectTrigger className="w-56"><SelectValue placeholder="Property" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All properties</SelectItem>
              {properties.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button
            variant={savedOnly ? "default" : "outline"}
            size="sm"
            onClick={() => setSavedOnly((v) => !v)}
          >
            <Star className="size-3.5" /> Saved only
          </Button>
          <div className="ml-auto text-xs text-muted-foreground">{filtered.length} of {rows.length}</div>
        </div>
      </Card>

      {loading ? (
        <div className="text-sm text-muted-foreground p-6 text-center">Loading…</div>
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No reports yet"
          description="Run Jarvis from the dashboard or the assistant to generate your first report."
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map((r) => (
            <Card key={r.id} className="p-3 flex flex-col gap-2 hover:bg-muted/30 transition-colors">
              <div className="flex items-start gap-2">
                <button
                  type="button"
                  className="flex-1 text-left"
                  onClick={() => setOpen(r)}
                >
                  <div className="text-sm font-medium truncate">{r.title}</div>
                  <div className="text-[11px] text-muted-foreground truncate">
                    {propertyName(r.property_id)} · {new Date(r.created_at).toLocaleString()}
                  </div>
                </button>
                <button type="button" onClick={() => toggleSaved(r)} title={r.saved ? "Unsave" : "Save"}>
                  <Star className={r.saved ? "size-4 fill-amber-400 text-amber-400" : "size-4 text-muted-foreground"} />
                </button>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <Badge variant="outline" className="text-[10px]">{typeLabel(r.report_type)}</Badge>
                {r.date_range_start && r.date_range_end && (
                  <Badge variant="outline" className="text-[10px]">
                    {r.date_range_start} → {r.date_range_end}
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-1 pt-1">
                <Button size="sm" variant="outline" onClick={() => setOpen(r)}>
                  <ExternalLink className="size-3.5" /> Open
                </Button>
                {r.session_id && (
                  <Button size="sm" variant="outline" asChild>
                    <Link to={`/assistant?session=${r.session_id}`}>
                      <MessageSquare className="size-3.5" /> In Jarvis
                    </Link>
                  </Button>
                )}
                <Button size="sm" variant="ghost" className="ml-auto text-destructive" onClick={() => softDelete(r)}>
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!open} onOpenChange={(v) => !v && setOpen(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{open?.title}</DialogTitle>
          </DialogHeader>
          {open && isReportSchema(open.schema_json) ? (
            <ReportView schema={open.schema_json as ReportSchema} reportId={open.id} />
          ) : (
            <div className="text-xs text-muted-foreground">This report uses an unsupported schema.</div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}