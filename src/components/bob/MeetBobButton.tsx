import { Button } from "@/components/ui/button";
import { useBobIntro } from "@/contexts/BobIntroContext";
import { BobFace } from "./BobFace";

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
      <span className="grid size-4 place-items-center">
        <BobFace scale={0.055} mood="happy" gx={0} gy={0} lid={0} />
      </span>
      <span className="hidden sm:inline">Meet Bob</span>
    </Button>
  );
}
