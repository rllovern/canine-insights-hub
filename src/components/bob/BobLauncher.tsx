import { useBob } from "@/contexts/BobContext";
import bobMark from "@/assets/jarvis-mark.png";
import { cn } from "@/lib/utils";

export function BobLauncher() {
  const { open, openBob } = useBob();

  return (
    <button
      type="button"
      data-tour="bob-launcher"
      aria-label="Ask Bob"
      title="Ask Bob"
      onClick={() => openBob()}
      className={cn(
        "fixed bottom-5 right-5 z-40 grid size-14 place-items-center rounded-full",
        "bg-primary text-primary-foreground shadow-lg shadow-black/20",
        "transition-all hover:scale-105 active:scale-95",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        open && "pointer-events-none opacity-0 scale-75",
      )}
    >
      <img src={bobMark} alt="" width={32} height={32} className="size-8" />
    </button>
  );
}

export default BobLauncher;
