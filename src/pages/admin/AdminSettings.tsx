import { useEffect, useMemo, useState } from "react";
import { Clock, Loader2, Save } from "lucide-react";
import { PageHeader } from "@/components/data/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ApiHealth } from "./ApiHealth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const PRESETS: Array<{ label: string; value: string }> = [
  { label: "Every hour", value: "0 * * * *" },
  { label: "Every 3 hours", value: "0 */3 * * *" },
  { label: "Every 6 hours", value: "0 */6 * * *" },
  { label: "Every 12 hours", value: "0 */12 * * *" },
  { label: "Once a day (midnight UTC)", value: "0 0 * * *" },
];

export default function AdminSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [schedule, setSchedule] = useState("0 */6 * * *");
  const [active, setActive] = useState(true);
  const [preset, setPreset] = useState<string>("custom");

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("get_sync_cron_schedule");
    setLoading(false);
    if (error) {
      toast.error(`Could not load schedule: ${error.message}`);
      return;
    }
    const row = (data as any[])?.[0];
    if (row) {
      setSchedule(row.schedule);
      setActive(row.active);
      const match = PRESETS.find((p) => p.value === row.schedule);
      setPreset(match ? match.value : "custom");
    }
  };

  useEffect(() => { load(); }, []);

  const onPresetChange = (v: string) => {
    setPreset(v);
    if (v !== "custom") setSchedule(v);
  };

  const onScheduleChange = (v: string) => {
    setSchedule(v);
    const match = PRESETS.find((p) => p.value === v);
    setPreset(match ? match.value : "custom");
  };

  const handleSave = async () => {
    if (!schedule.trim()) {
      toast.error("Schedule cannot be empty.");
      return;
    }
    setSaving(true);
    const { error } = await supabase.rpc("set_sync_cron_schedule", {
      _schedule: schedule.trim(),
      _active: active,
    });
    setSaving(false);
    if (error) {
      toast.error(`Save failed: ${error.message}`);
      return;
    }
    toast.success("Sync schedule updated.");
    load();
  };

  return (
    <div className="mx-auto max-w-5xl p-6 space-y-6">
      <PageHeader title="Settings" description="Workspace and integration preferences." />
      <Tabs defaultValue="schedule" className="space-y-4">
        <TabsList>
          <TabsTrigger value="schedule">Sync schedule</TabsTrigger>
          <TabsTrigger value="targets">Performance targets</TabsTrigger>
          <TabsTrigger value="health">API Health</TabsTrigger>
        </TabsList>
        <TabsContent value="schedule">
        <section className="rounded-xl border border-border bg-card p-6 space-y-5">
        <div className="flex items-start gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-md bg-primary/10 text-primary">
            <Clock className="h-4 w-4" />
          </div>
          <div className="flex-1">
            <h2 className="text-sm font-semibold">Automatic sync schedule</h2>
            <p className="text-xs text-muted-foreground">
              How often Lovable pulls Google Ads, CTM, GA4 and keyword data for every connected property.
            </p>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading current schedule…
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Preset</Label>
              <Select value={preset} onValueChange={onPresetChange}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRESETS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                  ))}
                  <SelectItem value="custom">Custom…</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cron-expr">Cron expression (UTC)</Label>
              <Input
                id="cron-expr"
                value={schedule}
                onChange={(e) => onScheduleChange(e.target.value)}
                className="font-mono"
                placeholder="0 */6 * * *"
              />
              <p className="text-[11px] text-muted-foreground">
                Standard 5-field cron, evaluated in UTC.
              </p>
            </div>

            <div className="sm:col-span-2 flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2">
              <div>
                <div className="text-sm font-medium">Schedule active</div>
                <p className="text-[11px] text-muted-foreground">
                  When off, automatic syncs pause. Manual "Sync now" still works per property.
                </p>
              </div>
              <Switch checked={active} onCheckedChange={setActive} />
            </div>

            <div className="sm:col-span-2 flex justify-end">
              <Button onClick={handleSave} disabled={saving}>
                {saving ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-1.5 h-4 w-4" />
                )}
                Save schedule
              </Button>
            </div>
          </div>
        )}
        </section>
        </TabsContent>
        <TabsContent value="targets">
          <TargetsEditor />
        </TabsContent>
        <TabsContent value="health">
          <ApiHealth />
        </TabsContent>
      </Tabs>
    </div>
  );
}

type PropertyRow = { id: string; name: string };
type TargetDraft = {
  cpl_target: string;
  cpgl_target: string;
  monthly_ad_budget: string;
  monthly_good_leads_goal: string;
};

function monthStart(value: string) {
  return `${value}-01`;
}

function currentMonthValue() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function emptyTarget(): TargetDraft {
  return { cpl_target: "", cpgl_target: "", monthly_ad_budget: "", monthly_good_leads_goal: "" };
}

function numberOrNull(v: string) {
  const trimmed = v.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

function TargetsEditor() {
  const [month, setMonth] = useState(currentMonthValue());
  const [properties, setProperties] = useState<PropertyRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, TargetDraft>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const periodStart = useMemo(() => monthStart(month), [month]);

  const loadTargets = async () => {
    setLoading(true);
    const [props, targets] = await Promise.all([
      supabase.from("properties").select("id,name").eq("is_active", true).order("name"),
      supabase.from("property_targets").select("property_id,cpl_target,cpgl_target,monthly_ad_budget,monthly_good_leads_goal").eq("period_start", periodStart),
    ]);
    if (props.error) toast.error(props.error.message);
    if (targets.error) toast.error(targets.error.message);
    const propRows = (props.data ?? []) as PropertyRow[];
    const byProperty = new Map((targets.data ?? []).map((t: any) => [t.property_id, t]));
    setProperties(propRows);
    setDrafts(Object.fromEntries(propRows.map((p) => {
      const t: any = byProperty.get(p.id);
      return [p.id, {
        cpl_target: t?.cpl_target == null ? "" : String(t.cpl_target),
        cpgl_target: t?.cpgl_target == null ? "" : String(t.cpgl_target),
        monthly_ad_budget: t?.monthly_ad_budget == null ? "" : String(t.monthly_ad_budget),
        monthly_good_leads_goal: t?.monthly_good_leads_goal == null ? "" : String(t.monthly_good_leads_goal),
      } satisfies TargetDraft];
    })));
    setLoading(false);
  };

  useEffect(() => { loadTargets(); }, [periodStart]);

  const updateDraft = (id: string, key: keyof TargetDraft, value: string) => {
    setDrafts((d) => ({ ...d, [id]: { ...(d[id] ?? emptyTarget()), [key]: value } }));
  };

  const saveTarget = async (property: PropertyRow) => {
    const d = drafts[property.id] ?? emptyTarget();
    setSavingId(property.id);
    const { error } = await supabase.from("property_targets").upsert({
      property_id: property.id,
      period_start: periodStart,
      cpl_target: numberOrNull(d.cpl_target),
      cpgl_target: numberOrNull(d.cpgl_target),
      monthly_ad_budget: numberOrNull(d.monthly_ad_budget),
      monthly_good_leads_goal: numberOrNull(d.monthly_good_leads_goal),
    }, { onConflict: "property_id,period_start" });
    setSavingId(null);
    if (error) toast.error(error.message);
    else toast.success(`Targets saved for ${property.name}.`);
  };

  return (
    <section className="rounded-xl border border-border bg-card p-6 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Performance targets</h2>
          <p className="text-xs text-muted-foreground">CPL is spend ÷ total leads. CPGL is spend ÷ good leads. Blank targets render neutral dots.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="target-month">Month</Label>
          <Input id="target-month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-40" />
        </div>
      </div>
      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading targets…</div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Property</th>
                <th className="px-3 py-2 text-right font-medium">CPL target</th>
                <th className="px-3 py-2 text-right font-medium">CPGL target</th>
                <th className="px-3 py-2 text-right font-medium">Monthly ad budget</th>
                <th className="px-3 py-2 text-right font-medium">Good leads goal</th>
                <th className="px-3 py-2 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {properties.map((p) => {
                const d = drafts[p.id] ?? emptyTarget();
                return (
                  <tr key={p.id}>
                    <td className="px-3 py-2 font-medium">{p.name}</td>
                    {(["cpl_target", "cpgl_target", "monthly_ad_budget", "monthly_good_leads_goal"] as const).map((key) => (
                      <td key={key} className="px-3 py-2">
                        <Input type="number" min="0" step="1" value={d[key]} onChange={(e) => updateDraft(p.id, key, e.target.value)} className="ml-auto h-8 w-32 text-right" placeholder="unset" />
                      </td>
                    ))}
                    <td className="px-3 py-2 text-right">
                      <Button size="sm" onClick={() => saveTarget(p)} disabled={savingId === p.id}>
                        {savingId === p.id ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
                        Save
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}