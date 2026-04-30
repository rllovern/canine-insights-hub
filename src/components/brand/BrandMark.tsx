import { cn } from "@/lib/utils";

interface BrandMarkProps {
  className?: string;
  showWordmark?: boolean;
}

/** Ridgeside Canine master logo — simple geometric mark + wordmark. */
export function BrandMark({ className, showWordmark = true }: BrandMarkProps) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="relative grid h-7 w-7 place-items-center rounded-md bg-primary text-primary-foreground shadow-sm">
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 18 L9 8 L13 13 L17 6 L21 18" />
        </svg>
      </div>
      {showWordmark && (
        <div className="flex flex-col leading-none">
          <span className="text-[13px] font-semibold tracking-tight text-foreground">Ridgeside</span>
          <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Canine</span>
        </div>
      )}
    </div>
  );
}