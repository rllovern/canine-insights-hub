import { HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTour } from "@/contexts/TourContext";

export function TourHelpButton() {
  const { available, start, running } = useTour();
  if (!available) return null;
  return (
    <Button
      variant="outline"
      size="sm"
      className="h-9 gap-1.5"
      onClick={start}
      disabled={running}
      title="Take the guided tour"
    >
      <HelpCircle className="size-4" />
      <span className="hidden sm:inline">Help</span>
    </Button>
  );
}
