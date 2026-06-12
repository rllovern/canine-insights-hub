import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { formatNum, formatPct, WINDOW_TOOLTIP } from "@/lib/leadPerf";
import { KpiTile } from "./KpiTile";

type Pipe = {
  needs_mapping: boolean;
  stages: Record<string, number>;
  transitions: Record<string, number>;
};

const FUNNEL: Array<{ key: string; label: string }> = [
  { key: "new", label: "New" },
  { key: "contacted", label: "Contacted" },
  { key: "engaged", label: "Engaged" },
  { key: "appointment", label: "Appointment" },
  { key: "showed", label: "Showed" },
  { key: "won", label: "Won" },
];

const TRANSITIONS: Array<{ key: string; label: string }> = [
  { key: "new_to_contacted", label: "New → Contacted" },
  { key: "contacted_to_engaged", label: "Contacted → Engaged" },
  { key: "engaged_to_appointment", label: "Engaged → Appointment" },
  { key: "appointment_to_showed", label: "Appointment → Showed" },
  { key: "showed_to_won", label: "Showed → Won" },
  { key: "lead_to_appointment", label: "Lead → Appointment" },
  { key: "lead_to_won", label: "Lead → Won" },
];

export function PipelineConversion({
  propertyIds, from, to,
}: {
  propertyIds: string[] | null; from: Date; to: Date;
}) {
  const [data, setData] = useState<Pipe | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    (async () => {
      const { data } = await supabase.rpc("lead_perf_pipeline", {
        _property_ids: propertyIds, _from: from.toISOString(), _to: to.toISOString(),
      });
      setData((data ?? null) as unknown as Pipe | null);
      setLoading(false);
    })();
  }, [propertyIds, from, to]);

  if (loading) return <Skeleton className="h-48 w-full rounded-lg" />;
  if (!data) return null;

  return (
    <div className="space-y-4">
      {data.needs_mapping && (
        <Alert>
          <AlertTriangle className="size-4" />
          <AlertDescription className="flex items-center justify-between gap-3">
            <span>One or more pipeline stages need admin confirmation. Auto-suggestions are not used until confirmed.</span>
            <Link to="/admin/pipeline-mapping" className="text-primary hover:underline text-xs whitespace-nowrap">
              Review mapping →
            </Link>
          </AlertDescription>
        </Alert>
      )}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        {FUNNEL.map((s) => (
          <KpiTile key={s.key} label={s.label} value={formatNum(data.stages[s.key])} tooltip={WINDOW_TOOLTIP} />
        ))}
      </div>
      <div className="rounded-lg border bg-card p-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground mb-3">Conversion transitions</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {TRANSITIONS.map((t) => (
            <div key={t.key} className="flex items-center justify-between text-sm border-b border-border/40 py-1.5 last:border-0">
              <span className="flex items-center gap-1 text-muted-foreground">
                {t.label.split(" → ").map((w, i, arr) => (
                  <span key={i} className="flex items-center gap-1">
                    {w}{i < arr.length - 1 && <ArrowRight className="size-3" />}
                  </span>
                ))}
              </span>
              <span className="font-medium tabular-nums">{formatPct(data.transitions[t.key])}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}