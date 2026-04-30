import { cn } from "@/lib/utils";
import { Property } from "@/lib/types";

interface PropertyAvatarProps {
  property: Pick<Property, "name" | "logo_url" | "primary_color">;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const sizeMap = {
  sm: "h-6 w-6 text-[10px]",
  md: "h-9 w-9 text-xs",
  lg: "h-14 w-14 text-base",
};

function initialsOf(name: string) {
  return name
    .replace(/Ridgeside\s*Canine\s*[—-]?\s*/i, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("") || "RC";
}

export function PropertyAvatar({ property, size = "md", className }: PropertyAvatarProps) {
  if (property.logo_url) {
    return (
      <img
        src={property.logo_url}
        alt={`${property.name} logo`}
        className={cn(
          "shrink-0 rounded-md object-cover ring-1 ring-border bg-muted",
          sizeMap[size],
          className,
        )}
      />
    );
  }
  return (
    <div
      className={cn(
        "shrink-0 grid place-items-center rounded-md font-semibold ring-1 ring-border",
        sizeMap[size],
        className,
      )}
      style={{
        backgroundColor: property.primary_color ?? "hsl(var(--primary-muted))",
        color: property.primary_color ? "white" : "hsl(var(--primary))",
      }}
    >
      {initialsOf(property.name)}
    </div>
  );
}