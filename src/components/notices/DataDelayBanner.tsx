import { AlertTriangle } from "lucide-react";
import { useNotices } from "@/contexts/NoticeContext";

/** Persistent, non-blocking notice shown while a data source is behind. */
export function DataDelayBanner() {
  const { delayNotices } = useNotices();
  if (delayNotices.length === 0) return null;

  return (
    <div className="space-y-2">
      {delayNotices.map((n) => (
        <div
          key={n.incidentId}
          className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2"
        >
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />
          <div className="min-w-0">
            <div className="text-[12px] font-semibold text-amber-700 dark:text-amber-400">{n.title}</div>
            <p className="text-[12px] text-muted-foreground">{n.body}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
