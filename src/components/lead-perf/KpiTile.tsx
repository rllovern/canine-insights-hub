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
  onClick,
  tooltip,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  hint?: string;
  tone?: "default" | "good" | "warn" | "bad";
  onClick?: () => void;
  tooltip?: string;
}) {
  const toneClass =
    tone === "good" ? "border-emerald-500/40"
    : tone === "warn" ? "border-amber-500/40"
    : tone === "bad" ? "border-rose-500/40"
    : "border-border";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        "rounded-lg border bg-card text-left p-4 transition-colors w-full",
        toneClass,
        onClick ? "hover:bg-accent/40 cursor-pointer" : "cursor-default",
      )}
    >
      <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
        <span className="truncate">{label}</span>
        {tooltip && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="size-3 shrink-0 opacity-70" />
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs">{tooltip}</TooltipContent>
          </Tooltip>
        )}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
      {hint && <div className="mt-1 text-[11px] text-muted-foreground/80">{hint}</div>}
    </button>
  );
}