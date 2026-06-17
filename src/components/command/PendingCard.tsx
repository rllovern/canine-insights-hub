import { Info } from "lucide-react";

/**
 * Honest empty-state card. Used anywhere a data dependency is missing —
 * never render a styled card on fabricated numbers.
 */
export function PendingCard({
  title,
  reason,
  href,
}: {
  title: string;
  reason: string;
  href?: string;
}) {
  return (
    <div className="rounded-2xl bg-white border border-dashed border-slate-300 p-3 h-full flex flex-col">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-500">{title}</h3>
        <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">
          Pending
        </span>
      </div>
      <div className="mt-2 flex-1 flex items-start gap-2 text-[12px] text-slate-500 leading-snug">
        <Info className="size-3.5 text-slate-400 shrink-0 mt-0.5" />
        <span>{reason}</span>
      </div>
      {href && (
        <a href={href} className="mt-2 text-[11px] font-medium text-blue-600 hover:underline">
          Configure data source →
        </a>
      )}
    </div>
  );
}