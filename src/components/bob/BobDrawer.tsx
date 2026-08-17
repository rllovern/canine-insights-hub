import { useEffect, useState } from "react";
import { useBob } from "@/contexts/BobContext";
import { BobChat } from "./BobChat";
import { BobFace, type BobMood } from "./BobFace";
import { useBobMood } from "./useBobMood";

export function BobDrawer() {
  const { open, closeBob } = useBob();
  const [thinking, setThinking] = useState(false);
  const bob = useBobMood(!open || thinking);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeBob(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, closeBob]);

  if (!open) return null;

  const setMood = (m: BobMood, hold?: number) => bob.express(m, hold);

  return (
    <div
      role="dialog"
      aria-label="Bob, your marketing analyst"
      className="fixed right-3 bottom-3 sm:right-6 sm:bottom-6 z-50 w-[calc(100vw-1.5rem)] sm:w-[400px]"
      style={{
        height: "min(660px, calc(100vh - 96px))",
        animation: "drawerIn .38s cubic-bezier(.2,.9,.3,1.05) both",
      }}
    >
      {/* Bob peeking over the top-left corner of the card */}
      <div className="absolute -top-[42px] left-4 z-[2]">
        {thinking && (
          <div className="absolute -top-3 -right-4 z-[3]">
            <span className="absolute bottom-0 right-6 size-[7px] rounded-full bg-card shadow-md" style={{ animation: "thoughtFloat 1.8s ease-out infinite" }} />
            <span className="absolute bottom-1.5 right-3 size-[11px] rounded-full bg-card shadow-md" style={{ animation: "thoughtFloat 1.8s ease-out .35s infinite" }} />
            <span className="absolute bottom-3.5 -right-1.5 size-4 rounded-full bg-card shadow-md" style={{ animation: "thoughtFloat 1.8s ease-out .7s infinite" }} />
          </div>
        )}
        <BobFace scale={0.62} mood={bob.mood} gx={bob.gx} gy={bob.gy} lid={bob.lid} />
      </div>

      <div className="flex h-full flex-col overflow-hidden rounded-[22px] border bg-card/95 shadow-2xl backdrop-blur-xl">
        <BobChat mood={bob.mood} setMood={setMood} onThinkingChange={setThinking} onClose={closeBob} />
      </div>
    </div>
  );
}

export default BobDrawer;
