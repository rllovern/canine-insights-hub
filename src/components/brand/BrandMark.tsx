import { cn } from "@/lib/utils";

interface BrandMarkProps {
  className?: string;
  showWordmark?: boolean;
  variant?: "default" | "onDark";
}

/** Ridgeside Canine master logo — simple geometric mark + wordmark. */
export function BrandMark({ className, showWordmark = true, variant = "default" }: BrandMarkProps) {
  const onDark = variant === "onDark";
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className={cn(
        "relative grid h-7 w-7 place-items-center rounded-md shadow-sm",
        onDark ? "bg-sidebar-primary text-sidebar-primary-foreground" : "bg-primary text-primary-foreground"
      )}>
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 18 L9 8 L13 13 L17 6 L21 18" />
        </svg>
      </div>
      {showWordmark && (
        <div className="flex flex-col leading-none">
          <span className={cn("text-[13px] font-semibold tracking-tight", onDark ? "text-sidebar-foreground" : "text-foreground")}>Ridgeside</span>
          <span className={cn("text-[10px] font-medium uppercase tracking-[0.14em]", onDark ? "text-sidebar-primary" : "text-muted-foreground")}>Canine</span>
        </div>
      )}
    </div>
  );
}