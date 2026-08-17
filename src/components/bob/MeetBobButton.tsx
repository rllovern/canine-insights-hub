import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useBobIntro } from "@/contexts/BobIntroContext";

export function MeetBobButton() {
  const { show } = useBobIntro();
  return (
    <Button
      variant="outline"
      size="sm"
      className="h-9 gap-1.5"
      onClick={show}
      title="What is Bob?"
    >
      <Sparkles className="size-4" />
      <span className="hidden sm:inline">Meet Bob</span>
    </Button>
  );
}
