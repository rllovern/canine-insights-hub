import { useBob } from "@/contexts/BobContext";
import { cn } from "@/lib/utils";
import { BobFace } from "./BobFace";
import { useBobMood } from "./useBobMood";

export function BobLauncher() {
  const { open, openBob } = useBob();
  const { mood, gx, gy, lid } = useBobMood(open);

  return (
    <div
      className={cn(
        "fixed right-3 bottom-3 sm:right-6 sm:bottom-6 z-40 flex items-end gap-3",
        open && "pointer-events-none opacity-0 scale-90 transition-all",
      )}
    >
      <div
        className="hidden sm:block mb-6 rounded-full border bg-card px-4 py-2 text-[13px] font-semibold text-card-foreground shadow-lg"
        style={{ animation: "pillIn .5s ease .8s both" }}
      >
        Ask Bob about your numbers
      </div>
      <button
        type="button"
        data-tour="bob-launcher"
        aria-label="Ask Bob"
        title="Ask Bob"
        onClick={() => openBob()}
        className="cursor-pointer rounded-full p-1 transition-transform hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <BobFace scale={0.72} mood={mood} gx={gx} gy={gy} lid={lid} />
      </button>
    </div>
  );
}

export default BobLauncher;
