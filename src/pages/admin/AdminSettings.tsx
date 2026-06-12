import { useEffect, useState } from "react";
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
        <TabsContent value="health">
          <ApiHealth />
        </TabsContent>
      </Tabs>
    </div>
  );
}