import { ReactNode, createContext, useContext } from "react";

type Variant = "card" | "plain";
const SectionDividerVariantContext = createContext<Variant>("card");

export function SectionDividerVariantProvider({
  variant,
  children,
}: {
  variant: Variant;
  children: ReactNode;
}) {
  return (
    <SectionDividerVariantContext.Provider value={variant}>
      {children}
    </SectionDividerVariantContext.Provider>
  );
}

export function SectionDivider({
  title,
  subtitle,
  right,
  variant: variantProp,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  variant?: Variant;
}) {
  const ctx = useContext(SectionDividerVariantContext);
  const variant = variantProp ?? ctx;

  if (variant === "plain") {
    return (
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[20px] font-bold tracking-tight text-slate-900 leading-tight">
            {title}
          </h2>
          {subtitle && (
            <p className="text-[11px] text-slate-500 mt-0.5">{subtitle}</p>
          )}
        </div>
        {right}
      </div>
    );
  }

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
