import { cn } from "@/lib/utils";
import logoUrl from "@/assets/ridgeside-logo.png";

interface BrandMarkProps {
  className?: string;
  showWordmark?: boolean;
  variant?: "default" | "onDark";
}

/** Ridgeside K9 master logo. */
export function BrandMark({ className, variant = "default" }: BrandMarkProps) {
  return (
    <div className={cn("flex items-center", className)}>
      <img
        src={logoUrl}
        alt="Ridgeside K9 — Professional Dog Training"
        className={cn(
          "w-auto object-contain",
          variant === "onDark" ? "h-14" : "h-12",
        )}
      />
    </div>
  );
}