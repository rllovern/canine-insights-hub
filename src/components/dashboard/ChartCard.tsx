import { ReactNode } from "react";

export function ChartCard({ title, subtitle, right, children }: { title: string; subtitle?: ReactNode; right?: ReactNode; children: ReactNode }) {
  return (
    <div className="min-w-0 overflow-hidden bg-card border border-border rounded-xl p-4 shadow-sm flex flex-col h-full">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div>
          <div className="text-sm font-semibold tracking-tight text-foreground">{title}</div>
          {subtitle && <div className="text-[11px] text-muted-foreground">{subtitle}</div>}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}
