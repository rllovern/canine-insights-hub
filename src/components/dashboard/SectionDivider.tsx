import { ReactNode } from "react";

export function SectionDivider({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <div className="section-divider flex items-center justify-between gap-3">
      <div>
        <div className="text-[13px] font-bold uppercase tracking-wider">{title}</div>
        {subtitle && <div className="text-[11px] font-medium opacity-70">{subtitle}</div>}
      </div>
      {right}
    </div>
  );
}
