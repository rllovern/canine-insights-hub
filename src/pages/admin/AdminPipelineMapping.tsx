import { useEffect, useMemo, useState } from "react";
import { Check, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/data/PageHeader";
import { useProperties } from "@/contexts/PropertyContext";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CANONICAL_STAGES, CanonicalStage } from "@/lib/leadPerf";

type StageRow = {
  ghl_pipeline_id: string;
  ghl_stage_id: string;
  name: string;
  position: number | null;
};
type MapRow = {
  ghl_stage_id: string;
  canonical_stage: CanonicalStage;
  suggested_canonical_stage: CanonicalStage | null;
  confirmed_by_user: boolean;
};
type PipelineRow = { ghl_pipeline_id: string; name: string };

export default function AdminPipelineMapping() {
  const { properties } = useProperties();
  const [propertyId, setPropertyId] = useState<string>("");
  const [pipelines, setPipelines] = useState<PipelineRow[]>([]);
  const [stages, setStages] = useState<StageRow[]>([]);
  const [mappings, setMappings] = useState<Record<string, MapRow>>({});
  const [loading, setLoading] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);

  useEffect(() => {
    if (!propertyId && properties.length) setPropertyId(properties[0].id);
  }, [properties, propertyId]);

  const load = async () => {
    if (!propertyId) return;
    setLoading(true);
    const [{ data: pp }, { data: ss }, { data: mm }] = await Promise.all([
      supabase.from("ghl_pipelines").select("ghl_pipeline_id, name").eq("property_id", propertyId),
      supabase.from("ghl_pipeline_stages").select("ghl_pipeline_id, ghl_stage_id, name, position").eq("property_id", propertyId).order("position", { ascending: true }),
      supabase.from("property_pipeline_mapping").select("ghl_stage_id, canonical_stage, suggested_canonical_stage, confirmed_by_user").eq("property_id", propertyId),
    ]);
    setPipelines((pp ?? []) as PipelineRow[]);
    setStages((ss ?? []) as StageRow[]);
    setMappings(Object.fromEntries(((mm ?? []) as MapRow[]).map((m) => [m.ghl_stage_id, m])));
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [propertyId]);

  const seed = async () => {
    if (!propertyId) return;
    setSeeding(true);
    const { error } = await supabase.rpc("seed_pipeline_mapping_suggestions", { _property_id: propertyId });
    setSeeding(false);
    if (error) toast.error(error.message);
    else { toast.success("Suggestions seeded"); load(); }
  };

  const rebuild = async () => {
    if (!propertyId) return;
    setRebuilding(true);
    const { error } = await supabase.rpc("rebuild_lead_facts", { _property_id: propertyId });
    setRebuilding(false);
    if (error) toast.error(error.message);
    else toast.success("Lead facts rebuilt");
  };

  const setCanonical = (stageId: string, value: CanonicalStage) => {
    setMappings((m) => {
      const prev = m[stageId];
      return { ...m, [stageId]: { ...(prev ?? { ghl_stage_id: stageId, suggested_canonical_stage: null, confirmed_by_user: false } as MapRow), canonical_stage: value } };
    });
  };

  const confirmRow = async (stage: StageRow) => {
    const m = mappings[stage.ghl_stage_id];
    if (!m) return;
    const payload = {
      property_id: propertyId,
      ghl_pipeline_id: stage.ghl_pipeline_id,
      ghl_stage_id: stage.ghl_stage_id,
      canonical_stage: m.canonical_stage,
      suggested_canonical_stage: m.suggested_canonical_stage,
      confirmed_by_user: true,
      confirmed_at: new Date().toISOString(),
    };
    const { error } = await supabase.from("property_pipeline_mapping").upsert(payload, { onConflict: "property_id,ghl_stage_id" });
    if (error) return toast.error(error.message);
    toast.success(`Confirmed: ${stage.name} → ${m.canonical_stage}`);
    load();
  };

  const confirmAll = async () => {
    const payloads = stages.map((s) => {
      const m = mappings[s.ghl_stage_id];
      const c: CanonicalStage = m?.canonical_stage ?? (m?.suggested_canonical_stage ?? "ignore");
      return {
        property_id: propertyId,
        ghl_pipeline_id: s.ghl_pipeline_id,
        ghl_stage_id: s.ghl_stage_id,
        canonical_stage: c,
        suggested_canonical_stage: m?.suggested_canonical_stage ?? null,
        confirmed_by_user: true,
        confirmed_at: new Date().toISOString(),
      };
    });
    const { error } = await supabase.from("property_pipeline_mapping").upsert(payloads, { onConflict: "property_id,ghl_stage_id" });
    if (error) return toast.error(error.message);
    toast.success(`Confirmed ${payloads.length} mappings`);
    load();
  };

  const pipeName = useMemo(() => Object.fromEntries(pipelines.map((p) => [p.ghl_pipeline_id, p.name])), [pipelines]);
  const unconfirmed = stages.filter((s) => !mappings[s.ghl_stage_id]?.confirmed_by_user).length;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Pipeline Mapping"
        description="Confirm how each GHL pipeline stage maps to a canonical funnel stage. Suggestions are never applied automatically — Lead Performance only uses confirmed mappings."
        actions={
          <div className="flex items-center gap-2">
            <Select value={propertyId} onValueChange={setPropertyId}>
              <SelectTrigger className="w-56"><SelectValue placeholder="Property" /></SelectTrigger>
              <SelectContent>
                {properties.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={seed} disabled={seeding}>
              <Sparkles className="size-3.5 mr-1" /> {seeding ? "Seeding…" : "Seed suggestions"}
            </Button>
            <Button variant="outline" size="sm" onClick={rebuild} disabled={rebuilding}>
              <RefreshCw className={`size-3.5 mr-1 ${rebuilding ? "animate-spin" : ""}`} /> Rebuild facts
            </Button>
          </div>
        }
      />

      <div className="flex items-center justify-between text-sm">
        <div className="text-muted-foreground">
          {loading ? "Loading…" : `${stages.length} stages • ${unconfirmed} unconfirmed`}
        </div>
        <Button size="sm" onClick={confirmAll} disabled={!stages.length}>
          <Check className="size-3.5 mr-1" /> Confirm all (use shown values)
        </Button>
      </div>

      <div className="rounded-lg border bg-card overflow-x-auto">
        {loading ? (
          <div className="p-4 space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pipeline</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead>Suggested</TableHead>
                <TableHead>Canonical</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stages.map((s) => {
                const m = mappings[s.ghl_stage_id];
                const current = m?.canonical_stage ?? m?.suggested_canonical_stage ?? "ignore";
                return (
                  <TableRow key={s.ghl_stage_id}>
                    <TableCell className="text-xs">{pipeName[s.ghl_pipeline_id] ?? s.ghl_pipeline_id}</TableCell>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell className="text-xs">{m?.suggested_canonical_stage ?? "—"}</TableCell>
                    <TableCell>
                      <Select value={current} onValueChange={(v) => setCanonical(s.ghl_stage_id, v as CanonicalStage)}>
                        <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {CANONICAL_STAGES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      {m?.confirmed_by_user
                        ? <Badge variant="secondary" className="text-[10px]">confirmed</Badge>
                        : <Badge variant="outline" className="text-[10px]">unconfirmed</Badge>}
                    </TableCell>
                    <TableCell>
                      <Button size="sm" variant="ghost" onClick={() => confirmRow(s)}>
                        <Check className="size-3.5 mr-1" /> Confirm
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}