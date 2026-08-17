import { useNavigate } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { rangeToISO, type DateRange } from "@/lib/metrics";

type Props = {
  prompt: string;
  label?: string;
  range?: DateRange;
  variant?: "default" | "outline" | "ghost" | "secondary";
  size?: "default" | "sm" | "icon";
  className?: string;
};

/**
 * Embedded Bob entry point. Renders a small "Ask Bob" / "Run with Bob"
 * button that deep-links to /assistant with the prompt (and optionally a date
 * range). The location is always taken from the sidebar location selector.
 */
export function AskBobButton({
  prompt,
  label = "Ask Bob",
  range,
  variant = "outline",
  size = "sm",
  className,
}: Props) {
  const nav = useNavigate();

  const go = () => {
    const sp = new URLSearchParams();
    sp.set("q", prompt);
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

export default AskBobButton;