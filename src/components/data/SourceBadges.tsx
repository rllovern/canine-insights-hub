import { cn } from "@/lib/utils";
import { DataSource } from "@/lib/types";

const LABELS: Record<DataSource, string> = {
  google_ads: "Google Ads",
  ctm: "CTM",
  ga4: "GA4",
};

export function SourceBadges({
  connected,
}: {
  connected: DataSource[];
}) {
  const all: DataSource[] = ["google_ads", "ctm", "ga4"];
  return (
    <div className="flex flex-wrap gap-1">
      {all.map((s) => {
        const isOn = connected.includes(s);
        return (
          <span
            key={s}
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset",
              isOn
                ? "bg-success/10 text-success ring-success/20"
                : "bg-muted text-muted-foreground ring-border",
            )}
          >
            <span className={cn("h-1.5 w-1.5 rounded-full", isOn ? "bg-success" : "bg-muted-foreground/40")} />
            {LABELS[s]}
          </span>
        );
      })}
    </div>
  );
}