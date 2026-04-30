import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { usePreviewMode } from "@/contexts/PreviewModeContext";
import { Eye } from "lucide-react";

export function ModeBadge() {
  const { realRole, effectiveRole, isPreviewing, togglePreview } = usePreviewMode();
  if (!effectiveRole) return null;

  const isInternal = effectiveRole === "internal";

  return (
    <div className="flex items-center gap-2">
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ring-inset",
          isInternal
            ? "bg-badge-internal/10 text-badge-internal ring-badge-internal/20"
            : "bg-badge-viewer/10 text-badge-viewer ring-badge-viewer/30",
        )}
      >
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            isInternal ? "bg-badge-internal" : "bg-badge-viewer",
          )}
        />
        {isInternal ? "Internal View" : "Viewer View"}
      </span>
      {realRole === "internal" && (
        <button
          type="button"
          onClick={togglePreview}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted",
            isPreviewing && "border-badge-viewer/40 text-foreground",
          )}
          title="Toggle preview as viewer"
        >
          <Eye className="h-3 w-3" />
          Preview
          <Switch checked={isPreviewing} className="ml-1 scale-75" />
        </button>
      )}
    </div>
  );
}