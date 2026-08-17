import { useBob } from "@/contexts/BobContext";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { type DateRange } from "@/lib/metrics";

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
 * button that opens the Bob drawer with the prompt prefilled and sent. The
 * location and dates always come from the sidebar selectors.
 */
export function AskBobButton({
  prompt,
  label = "Ask Bob",
  variant = "outline",
  size = "sm",
  className,
}: Props) {
  const { openBob } = useBob();

  const go = () => openBob(prompt);

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