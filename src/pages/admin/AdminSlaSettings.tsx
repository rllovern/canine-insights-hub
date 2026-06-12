import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/data/PageHeader";
import { useProperties } from "@/contexts/PropertyContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";

type Agency = {
  first_response_seconds: number;
  stale_after_hours: number;
  critical_stale_after_hours: number;
  active_window_days: number;
  attempts_24h: number;
  attempts_7d: number;
  business_hours_only: boolean;
  after_hours_mode: string;
};

type Property = {
  property_id: string;
  first_response_seconds: number | null;
  stale_after_hours: number | null;
  critical_stale_after_hours: number | null;
  active_window_days: number | null;
  attempts_24h: number | null;
  attempts_7d: number | null;
  business_hours_only: boolean | null;
  after_hours_mode: string | null;
  timezone: string | null;
};

const NUM_FIELDS: Array<{ key: keyof Agency; label: string; suffix: string }> = [
  { key: "first_response_seconds", label: "First response target", suffix: "sec" },
  { key: "stale_after_hours", label: "Stale after", suffix: "hours" },
  { key: "critical_stale_after_hours", label: "Critical stale after", suffix: "hours" },
  { key: "active_window_days", label: "Active waiting window", suffix: "days" },
  { key: "attempts_24h", label: "Target attempts in 24h", suffix: "" },
  { key: "attempts_7d", label: "Target attempts in 7d", suffix: "" },
];

export default function AdminSlaSettings() {
  const { properties } = useProperties();
  const [agency, setAgency] = useState<Agency | null>(null);
  const [propertyId, setPropertyId] = useState<string>("");
  const [override, setOverride] = useState<Property | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!propertyId && properties.length) setPropertyId(properties[0].id);
  }, [properties, propertyId]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await supabase.from("agency_sla_defaults").select("*").maybeSingle();
      setAgency((data ?? {
        first_response_seconds: 300, stale_after_hours: 24, critical_stale_after_hours: 48,
        active_window_days: 30, attempts_24h: 3, attempts_7d: 6, business_hours_only: false, after_hours_mode: "include",
      }) as Agency);
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (!propertyId) return;
    (async () => {
      const { data } = await supabase.from("property_sla_settings").select("*").eq("property_id", propertyId).maybeSingle();
      setOverride((data ?? { property_id: propertyId, first_response_seconds: null, stale_after_hours: null, critical_stale_after_hours: null, active_window_days: null, attempts_24h: null, attempts_7d: null, business_hours_only: null, after_hours_mode: null, timezone: null }) as Property);
    })();
  }, [propertyId]);

  const saveAgency = async () => {
    if (!agency) return;
    setSaving(true);
    const { error } = await supabase.from("agency_sla_defaults").upsert({ id: true, ...agency, updated_at: new Date().toISOString() }, { onConflict: "id" });
    setSaving(false);
    if (error) toast.error(error.message); else toast.success("Agency defaults saved");
  };

  const saveOverride = async () => {
    if (!override || !propertyId) return;
    setSaving(true);
    const { error } = await supabase.from("property_sla_settings").upsert({ ...override, property_id: propertyId, updated_at: new Date().toISOString() }, { onConflict: "property_id" });
    setSaving(false);
    if (error) toast.error(error.message); else toast.success("Property override saved");
  };

  if (loading || !agency) {
    return <Skeleton className="h-64 w-full rounded-lg" />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="SLA Settings"
        description="Agency-wide defaults apply to every property. Per-property overrides win when set. Leave a property field blank to inherit the agency default."
      />

      <section className="rounded-lg border bg-card p-5 space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide">Agency defaults</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {NUM_FIELDS.map((f) => (
            <div key={f.key} className="space-y-1">
              <Label className="text-xs">{f.label} {f.suffix && <span className="text-muted-foreground">({f.suffix})</span>}</Label>
              <Input
                type="number"
                value={agency[f.key] as number}
                onChange={(e) => setAgency({ ...agency, [f.key]: Number(e.target.value) })}
              />
            </div>
          ))}
          <div className="space-y-1">
            <Label className="text-xs">After-hours mode</Label>
            <Select value={agency.after_hours_mode} onValueChange={(v) => setAgency({ ...agency, after_hours_mode: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="include">Include after-hours leads</SelectItem>
                <SelectItem value="exclude">Exclude after-hours leads</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 pt-6">
            <Switch checked={agency.business_hours_only} onCheckedChange={(v) => setAgency({ ...agency, business_hours_only: v })} />
            <Label className="text-xs">Use business-hours STL only</Label>
          </div>
        </div>
        <div className="flex justify-end"><Button onClick={saveAgency} disabled={saving}>Save defaults</Button></div>
      </section>

      <section className="rounded-lg border bg-card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide">Per-property override</h2>
          <Select value={propertyId} onValueChange={setPropertyId}>
            <SelectTrigger className="w-56"><SelectValue placeholder="Property" /></SelectTrigger>
            <SelectContent>
              {properties.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {override && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {NUM_FIELDS.map((f) => (
                <div key={f.key} className="space-y-1">
                  <Label className="text-xs">
                    {f.label} <span className="text-muted-foreground">(default {agency[f.key]}{f.suffix && ` ${f.suffix}`})</span>
                  </Label>
                  <Input
                    type="number"
                    placeholder="inherit"
                    value={(override[f.key] as number | null) ?? ""}
                    onChange={(e) => setOverride({ ...override, [f.key]: e.target.value === "" ? null : Number(e.target.value) })}
                  />
                </div>
              ))}
              <div className="space-y-1">
                <Label className="text-xs">Timezone <span className="text-muted-foreground">(IANA)</span></Label>
                <Input
                  placeholder="inherit (property TZ)"
                  value={override.timezone ?? ""}
                  onChange={(e) => setOverride({ ...override, timezone: e.target.value || null })}
                />
              </div>
            </div>
            <div className="flex justify-end"><Button onClick={saveOverride} disabled={saving}>Save override</Button></div>
          </>
        )}
      </section>
    </div>
  );
}