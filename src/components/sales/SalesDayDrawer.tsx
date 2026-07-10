import { format } from "date-fns";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import type { SaleRecord } from "@/lib/verified-sales";

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  date: Date | null;
  records: SaleRecord[];
  weekdayAverage: number; // wins average for same weekday
  weekdayAverageRevenue: number;
}

export function SalesDayDrawer({ open, onOpenChange, date, records, weekdayAverage, weekdayAverageRevenue }: Props) {
  if (!date) return null;
  const count = records.length;
  const revenue = records.reduce((s, r) => s + (r.amount ?? 0), 0);
  const avgDeal = count > 0 ? revenue / count : 0;
  const winDelta = weekdayAverage > 0 ? ((count - weekdayAverage) / weekdayAverage) * 100 : null;
  const revDelta = weekdayAverageRevenue > 0 ? ((revenue - weekdayAverageRevenue) / weekdayAverageRevenue) * 100 : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{format(date, "EEEE, MMMM d, yyyy")}</SheetTitle>
          <SheetDescription>
            {count === 0 ? "No won deals on this day." : `${count} won deal${count === 1 ? "" : "s"} · ${currency.format(revenue)} closed`}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 grid grid-cols-3 gap-2">
          <Stat label="Wins" value={String(count)} />
          <Stat label="Revenue" value={currency.format(revenue)} />
          <Stat label="Avg deal" value={count > 0 ? currency.format(avgDeal) : "—"} />
        </div>

        {(winDelta != null || revDelta != null) && (
          <div className="mt-3 text-xs text-muted-foreground">
            {winDelta != null && (
              <div>
                <span className={winDelta >= 0 ? "text-emerald-500" : "text-rose-500"}>
                  {winDelta >= 0 ? "▲" : "▼"} {Math.abs(winDelta).toFixed(0)}%
                </span>{" "}
                vs. average {format(date, "EEEE")} ({weekdayAverage.toFixed(1)} wins)
              </div>
            )}
          </div>
        )}

        <div className="mt-6 rounded-lg border border-border overflow-hidden">
          {records.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">Nothing closed on this day.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="text-left font-medium px-3 py-2">Name</th>
                  <th className="text-left font-medium px-3 py-2">Time</th>
                  <th className="text-right font-medium px-3 py-2">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {records
                  .slice()
                  .sort((a, b) => (b.won_at ?? "").localeCompare(a.won_at ?? ""))
                  .map((r) => (
                    <tr key={r.opportunity_id}>
                      <td className="px-3 py-2">
                        <div className="font-medium">{r.name ?? "—"}</div>
                        {r.email && <div className="text-xs text-muted-foreground">{r.email}</div>}
                        {r.phone && <div className="text-xs text-muted-foreground tabular-nums">{r.phone}</div>}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-muted-foreground tabular-nums">
                        {r.won_at ? format(new Date(r.won_at), "h:mm a") : "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {r.amount == null ? "—" : currency.format(r.amount)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-base font-semibold tabular-nums">{value}</div>
    </div>
  );
}