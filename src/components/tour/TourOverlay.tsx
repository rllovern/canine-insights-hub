import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { useLocation } from "react-router-dom";
import { ArrowLeft, ArrowRight, X, Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTour } from "@/contexts/TourContext";

type Rect = { top: number; left: number; width: number; height: number };

const PAD = 8;
const BUBBLE_W = 360;

export function TourOverlay() {
  const { running, step, index, total, next, back, stop } = useTour();
  const location = useLocation();
  const [rect, setRect] = useState<Rect | null>(null);
  const [ready, setReady] = useState(false);
  const [bubbleH, setBubbleH] = useState(260);
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const skipRef = useRef<number | null>(null);

  // Measure the bubble so it can always be placed fully on screen.
  useEffect(() => {
    const el = bubbleRef.current;
    if (!el) return;
    const h = el.getBoundingClientRect().height;
    if (h && Math.abs(h - bubbleH) > 2) setBubbleH(h);
  });

  const onRoute = !!step && location.pathname === step.route;

  // Locate the target element, retrying while the page loads.
  useLayoutEffect(() => {
    setRect(null);
    setReady(false);
    if (skipRef.current) window.clearTimeout(skipRef.current);
    if (!running || !step || !onRoute) return;
    if (!step.target) {
      setReady(true);
      return;
    }

    let raf = 0;
    let tries = 0;
    let found: Element | null = null;

    const measure = () => {
      if (!found) return;
      const r = found.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    };

    const tick = () => {
      const el = document.querySelector(step.target!);
      if (el) {
        found = el;
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        setReady(true);
        measure();
        // Keep measuring while the smooth scroll settles.
        let settle = 0;
        const follow = () => {
          measure();
          settle += 1;
          if (settle < 60) raf = requestAnimationFrame(follow);
        };
        raf = requestAnimationFrame(follow);
        return;
      }
      tries += 1;
      if (tries > 40) {
        // Element never showed up (e.g. no data on this page) — skip the step.
        skipRef.current = window.setTimeout(() => next(), 0);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const onMove = () => measure();
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [running, step, onRoute, next]);

  // Block background interaction while the tour runs.
  useEffect(() => {
    if (!running) return;
    const prev = document.body.style.overflow;
    return () => {
      document.body.style.overflow = prev;
    };
  }, [running]);

  if (!running || !step) return null;

  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let bubbleStyle: React.CSSProperties;
  if (rect) {
    const h = bubbleH;
    const gap = 16;
    const clampTop = (v: number) => Math.min(Math.max(12, v), Math.max(12, vh - h - 12));
    const clampLeft = (v: number) => Math.min(Math.max(12, v), Math.max(12, vw - BUBBLE_W - 12));
    const centeredLeft = clampLeft(rect.left + rect.width / 2 - BUBBLE_W / 2);
    const centeredTop = clampTop(rect.top + rect.height / 2 - h / 2);

    const fitsBelow = rect.top + rect.height + gap + h + 12 <= vh;
    const fitsAbove = rect.top - gap - h >= 12;
    const fitsRight = rect.left + rect.width + gap + BUBBLE_W + 12 <= vw;
    const fitsLeft = rect.left - gap - BUBBLE_W >= 12;

    if (fitsBelow) {
      bubbleStyle = { top: rect.top + rect.height + gap, left: centeredLeft, width: BUBBLE_W };
    } else if (fitsAbove) {
      bubbleStyle = { top: rect.top - gap - h, left: centeredLeft, width: BUBBLE_W };
    } else if (fitsRight) {
      bubbleStyle = { top: centeredTop, left: rect.left + rect.width + gap, width: BUBBLE_W };
    } else if (fitsLeft) {
      bubbleStyle = { top: centeredTop, left: rect.left - gap - BUBBLE_W, width: BUBBLE_W };
    } else {
      // Target fills the screen — park the bubble in a readable, always-visible spot.
      bubbleStyle = { top: clampTop(vh - h - 24), left: clampLeft(vw / 2 - BUBBLE_W / 2), width: BUBBLE_W };
    }
  } else {
    bubbleStyle = {
      top: Math.max(12, vh / 2 - bubbleH / 2),
      left: Math.max(12, vw / 2 - BUBBLE_W / 2),
      width: BUBBLE_W,
    };
  }

  const progress = ((index + 1) / total) * 100;

  return createPortal(
    <div className="fixed inset-0 z-[999]">
      {/* Dimmer with a cut-out around the highlighted element. */}
      {rect ? (
        <motion.div
          key="spot"
          className="pointer-events-none absolute rounded-xl ring-2 ring-primary"
          initial={false}
          animate={{
            top: rect.top - PAD,
            left: rect.left - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
          }}
          transition={{ type: "spring", stiffness: 320, damping: 34 }}
          style={{ boxShadow: "0 0 0 9999px rgba(2, 6, 23, 0.66)" }}
        />
      ) : (
        <div className="absolute inset-0 bg-slate-950/70" />
      )}

      {/* Click shield: keeps clicks from reaching the app underneath. */}
      <div className="absolute inset-0" onClick={(e) => e.stopPropagation()} />

      <AnimatePresence mode="wait">
        {(ready || !step.target) && (
          <motion.div
            key={step.id}
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.2 }}
            className="absolute rounded-2xl border border-border bg-card p-5 shadow-2xl"
            style={bubbleStyle}
            ref={bubbleRef}
          >
            <div className="mb-3 flex items-start gap-3">
              <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                <Lightbulb className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Step {index + 1} of {total}
                </div>
                <h2 className="text-base font-semibold leading-tight text-foreground">{step.title}</h2>
              </div>
              <button
                type="button"
                onClick={() => stop(false)}
                aria-label="Close tour"
                className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>

            <p className="text-sm leading-relaxed text-foreground/90">{step.body}</p>
            {step.action && (
              <p className="mt-2 rounded-lg bg-muted/60 px-3 py-2 text-sm leading-relaxed text-muted-foreground">
                {step.action}
              </p>
            )}

            <div className="mt-4 h-1 w-full overflow-hidden rounded-full bg-muted">
              <motion.div
                className="h-full rounded-full bg-primary"
                initial={false}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.3 }}
              />
            </div>

            <div className="mt-4 flex items-center justify-between gap-2">
              <Button variant="ghost" size="sm" onClick={() => stop(false)}>
                Skip tour
              </Button>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={back} disabled={index === 0}>
                  <ArrowLeft className="mr-1 size-4" /> Back
                </Button>
                <Button size="sm" onClick={next}>
                  {index + 1 === total ? "Done" : "Next"}
                  {index + 1 !== total && <ArrowRight className="ml-1 size-4" />}
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>,
    document.body,
  );
}
