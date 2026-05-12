import { cn } from "@/lib/utils";
import logoUrl from "@/assets/ridgeside-k9-logo.webp";

interface BrandMarkProps {
  className?: string;
  showWordmark?: boolean;
  variant?: "default" | "onDark";
}

/** Ridgeside Canine master logo — simple geometric mark + wordmark. */
export function BrandMark({ className, showWordmark = true, variant = "default" }: BrandMarkProps) {
  const onDark = variant === "onDark";
  return (
    <div className={cn("flex items-center", className)}>
      <img
        src={logoUrl}
        alt="Ridgeside K9 — Professional Dog Training"
        className={cn(
          "object-contain",
          showWordmark ? "h-10 w-auto" : "h-8 w-8",
          onDark && "drop-shadow-[0_1px_2px_rgba(0,0,0,0.4)]"
        )}
      />
    </div>
  );
}