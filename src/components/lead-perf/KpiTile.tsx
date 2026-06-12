import { ReactNode } from "react";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function KpiTile({
  label,
  value,
  hint,
  sub,
  tone = "default",
  size = "md",
  emphasis = "default",
  onClick,
  tooltip,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  hint?: string;
  tone?: "default" | "good" | "warn" | "bad";
  size?: "sm" | "md";
  emphasis?: "default" | "muted";
  onClick?: () => void;
  tooltip?: string;
}) {
  // Quiet borders; use left accent + subtle background only for bad/warn so the page
  // doesn't look like every card is on fire.
  const accent =
    tone === "bad"  ? "border-l-4 border-l-rose-500 bg-rose-500/[0.04]"
  : tone === "warn" ? "border-l-4 border-l-amber-500/70"
  : tone === "good" ? "border-l-4 border-l-emerald-500/70"
  : "";
  const muted = emphasis === "muted";
  const pad = size === "sm" ? "p-2.5" : "p-3";
  const valueSize = size === "sm" ? "text-lg" : "text-xl";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        "rounded-lg border bg-card text-left transition-colors w-full border-border",
        pad,
        accent,
        muted && "bg-muted/30 border-border/60",
        onClick ? "hover:bg-accent/40 cursor-pointer" : "cursor-default",
      )}
    >
      <div className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-wide text-muted-foreground">
        <span className="truncate font-medium">{label}</span>
        {tooltip && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="size-3 shrink-0 opacity-70" />
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs">{tooltip}</TooltipContent>
          </Tooltip>
        )}
      </div>
      <div className={cn("mt-0.5 font-semibold tabular-nums leading-tight", valueSize, muted && "text-muted-foreground")}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-muted-foreground/90 leading-snug">{sub}</div>}
      {hint && <div className="mt-0.5 text-[10.5px] text-muted-foreground/70">{hint}</div>}
    </button>
  );
}