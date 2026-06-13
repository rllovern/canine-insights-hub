import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { JarvisChat } from "@/components/jarvis/JarvisChat";

export default function Assistant() {
  const [params, setParams] = useSearchParams();
  // Strip ?q= after a brief delay so JarvisChat can pick it up on first render.
  useEffect(() => {
    const q = params.get("q");
    if (q) {
      // Defer to next tick so JarvisChat mounts before we read it elsewhere.
      const t = setTimeout(() => {
        const evt = new CustomEvent("jarvis:prefill", { detail: q });
        window.dispatchEvent(evt);
        const next = new URLSearchParams(params);
        next.delete("q");
        setParams(next, { replace: true });
      }, 50);
      return () => clearTimeout(t);
    }
  }, [params, setParams]);

  return (
    <div className="space-y-3">
      <JarvisChat />
    </div>
  );
}