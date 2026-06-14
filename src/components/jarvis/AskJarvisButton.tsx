import { useNavigate } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useScope } from "@/contexts/ScopeContext";
import { rangeToISO, type DateRange } from "@/lib/metrics";

type Props = {
  prompt: string;
  label?: string;
  range?: DateRange;
  propertyId?: string;
  variant?: "default" | "outline" | "ghost" | "secondary";
  size?: "default" | "sm" | "icon";
  className?: string;
};

/**
 * Embedded Jarvis entry point. Renders a small "Ask Jarvis" / "Run with Jarvis"
 * button that deep-links to /assistant with prompt + scope params, inheriting
 * the current property + date range when not explicitly overridden.
 */
export function AskJarvisButton({
  prompt,
  label = "Ask Jarvis",
  range,
  propertyId,
  variant = "outline",
  size = "sm",
  className,
}: Props) {
  const nav = useNavigate();
  const { activeProperty } = useScope();

  const go = () => {
    const sp = new URLSearchParams();
    sp.set("q", prompt);
    const pid = propertyId ?? activeProperty?.id;
    if (pid) sp.set("propertyId", pid);
    if (range) {
      try {
        const iso = rangeToISO(range);
        sp.set("from", iso.from);
        sp.set("to", iso.to);
      } catch { /* noop */ }
    }
    nav(`/assistant?${sp.toString()}`);
  };

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      onClick={go}
      className={className}
    >
      <Sparkles className="size-3.5 mr-1.5 text-primary" />
      {label}
    </Button>
  );
}

export default AskJarvisButton;