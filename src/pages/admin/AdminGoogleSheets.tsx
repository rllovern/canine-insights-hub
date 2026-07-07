import { useEffect, useState } from "react";
import { Loader2, RefreshCw, CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface PropertyMap {
  id: string;
  name: string;
  google_sheet_tab: string | null;
  suggested_tab: string | null;
}
interface ListResponse {
  tabs: string[];
  properties: PropertyMap[];
}
interface Config {
  spreadsheet_id: string | null;
  last_sync_at: string | null;
  last_sync_status: string | null;
  last_sync_error: string | null;
}

function relTime(iso: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export default function AdminGoogleSheets() {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [spreadsheetInput, setSpreadsheetInput] = useState("");
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const loadConfig = async () => {
    const { data: row } = await supabase
      .from("sheet_sync_config")
      .select("spreadsheet_id, last_sync_at, last_sync_status, last_sync_error")
      .maybeSingle();
    if (row) {
      setCfg(row as Config);
      setSpreadsheetInput(row.spreadsheet_id ?? "");
    }
  };

  const loadTabs = async () => {
    setLoading(true);
    const { data: res, error } = await supabase.functions.invoke("sync-sheet-sales", {
      body: { action: "list_tabs" },
    });
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    if ((res as { error?: string })?.error) { toast.error((res as { error: string }).error); return; }
    setData(res as ListResponse);
  };

  useEffect(() => { loadConfig().then(loadTabs); }, []);

  const saveSpreadsheet = async () => {
    setBusy("save");
    const { data: res, error } = await supabase.functions.invoke("sync-sheet-sales", {
      body: { action: "set_spreadsheet_id", spreadsheet_id: spreadsheetInput },
    });
    setBusy(null);
    if (error || (res as { error?: string })?.error) {
      toast.error(error?.message ?? (res as { error: string }).error);
      return;
    }
    toast.success("Spreadsheet saved");
    await loadConfig();
    await loadTabs();
  };

  const setPropertyTab = async (property_id: string, tab: string | null) => {
    const { data: res, error } = await supabase.functions.invoke("sync-sheet-sales", {
      body: { action: "set_property_tab", property_id, tab },
    });
    if (error || (res as { error?: string })?.error) {
      toast.error(error?.message ?? (res as { error: string }).error);
      return;
    }
    setData((d) => d ? {
      ...d,
      properties: d.properties.map((p) => p.id === property_id ? { ...p, google_sheet_tab: tab } : p),
    } : d);
  };

  const syncNow = async () => {
    setBusy("sync");
    const { data: res, error } = await supabase.functions.invoke("sync-sheet-sales", {
      body: { action: "sync" },
    });
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    const r = res as { total_imported?: number; error?: string | null };
    if (r?.error) toast.warning(`Sync partial: ${r.error}`);
    else toast.success(`Imported ${r?.total_imported ?? 0} rows`);
    await loadConfig();
  };

  const applyAllSuggestions = async () => {
    if (!data) return;
    setBusy("apply-all");
    for (const p of data.properties) {
      if (!p.google_sheet_tab && p.suggested_tab) {
        await setPropertyTab(p.id, p.suggested_tab);
      }
    }
    setBusy(null);
    toast.success("Applied auto-matched tabs");
  };

  const status = cfg?.last_sync_status;
  const StatusIcon = status === "success" ? CheckCircle2 : status === "failure" ? XCircle : status === "partial" ? AlertCircle : null;

  return (
    <div className="space-y-4">
      <div className="border-b border-border pb-3">
        <h1 className="text-lg font-semibold tracking-tight">Google Sheets (Sales)</h1>
        <p className="text-[12px] text-muted-foreground mt-0.5">
          Verified Sale counts everywhere in the app (except Call Tracking) are imported from this sheet.
          Configure one master spreadsheet, then map each property to its tab.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <div className="text-sm font-semibold">Master spreadsheet</div>
        <div className="flex gap-2">
          <Input
            placeholder="Google Sheet URL or ID"
            value={spreadsheetInput}
            onChange={(e) => setSpreadsheetInput(e.target.value)}
          />
          <Button onClick={saveSpreadsheet} disabled={busy === "save"}>
            {busy === "save" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
          </Button>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          {StatusIcon && (
            <span className={cn(
              "inline-flex items-center gap-1",
              status === "success" && "text-success",
              status === "failure" && "text-destructive",
              status === "partial" && "text-amber-600",
            )}>
              <StatusIcon className="h-3.5 w-3.5" />
              {status}
            </span>
          )}
          <span>Last sync: {relTime(cfg?.last_sync_at ?? null)}</span>
          {cfg?.last_sync_error && <span className="truncate max-w-[400px]" title={cfg.last_sync_error}>· {cfg.last_sync_error}</span>}
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="outline" onClick={loadTabs} disabled={loading}>
              <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", loading && "animate-spin")} /> Reload tabs
            </Button>
            <Button size="sm" onClick={syncNow} disabled={busy === "sync" || !cfg?.spreadsheet_id}>
              {busy === "sync" ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
              Sync now
            </Button>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <div className="flex-1">
            <div className="text-sm font-semibold">Property → Tab mapping</div>
            <div className="text-[11px] text-muted-foreground">
              Auto-matched by property name. Change the dropdown to override.
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={applyAllSuggestions} disabled={busy === "apply-all" || !data}>
            {busy === "apply-all" ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
            Apply all auto-matches
          </Button>
        </div>
        {loading ? (
          <div className="p-4 text-xs text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
          </div>
        ) : !data || data.properties.length === 0 ? (
          <div className="p-4 text-xs text-muted-foreground">No properties.</div>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left font-medium px-4 py-2">Property</th>
                <th className="text-left font-medium px-2 py-2">Suggested</th>
                <th className="text-left font-medium px-2 py-2 w-[280px]">Mapped tab</th>
              </tr>
            </thead>
            <tbody>
              {data.properties.map((p) => (
                <tr key={p.id} className="border-t border-border/60">
                  <td className="px-4 py-2 font-medium">{p.name}</td>
                  <td className="px-2 py-2 text-muted-foreground">{p.suggested_tab ?? "—"}</td>
                  <td className="px-2 py-2">
                    <select
                      className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs"
                      value={p.google_sheet_tab ?? ""}
                      onChange={(e) => setPropertyTab(p.id, e.target.value || null)}
                    >
                      <option value="">— Not mapped —</option>
                      {data.tabs.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}