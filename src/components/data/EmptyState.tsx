import { ReactNode } from "react";
import { Inbox } from "lucide-react";

export function EmptyState({
  title = "No data for this date range yet",
  description = "Try syncing from Settings, or pick a wider date range.",
  icon,
  action,
}: {
  title?: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="grid place-items-center rounded-xl border border-dashed border-border bg-card/40 px-6 py-12 text-center">
      <div className="mx-auto grid h-10 w-10 place-items-center rounded-lg bg-muted text-muted-foreground">
        {icon ?? <Inbox className="h-5 w-5" />}
      </div>
      <h3 className="mt-3 text-sm font-semibold">{title}</h3>
      <p className="mt-1 max-w-sm text-xs text-muted-foreground">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}