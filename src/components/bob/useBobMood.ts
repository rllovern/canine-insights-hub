import { useCallback, useEffect, useRef, useState } from "react";
import { MOODS, type BobMood } from "./BobFace";

type State = { mood: BobMood; gx: number; gy: number; lid: number };

/**
 * Drives Bob's face: random blinking, idle glances/yawns, and explicit mood
 * changes requested by the chat (thinking, curious, concerned…).
 */
export function useBobMood(paused = false) {
  const [state, setState] = useState<State>({ mood: "happy", gx: 0, gy: 0, lid: 0 });
  const stateRef = useRef(state);
  stateRef.current = state;
  const busy = useRef(false);
  const timers = useRef<number[]>([]);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  const later = useCallback((fn: () => void, ms: number) => {
    const id = window.setTimeout(fn, ms);
    timers.current.push(id);
    return id;
  }, []);

  const setMood = useCallback((mood: BobMood, holdGaze = false) => {
    const M = MOODS[mood] ?? MOODS.happy;
    setState((s) => ({
      mood,
      gx: holdGaze ? s.gx : M.gx,
      gy: holdGaze ? s.gy : M.gy,
      lid: M.lid,
    }));
  }, []);

  // Blinking
  useEffect(() => {
    let alive = true;
    const schedule = () => {
      later(() => {
        if (!alive) return;
        if (stateRef.current.lid < 0.8) {
          setState((s) => ({ ...s, lid: 1 }));
          later(() => setState((s) => ({ ...s, lid: MOODS[s.mood].lid })), 140);
        }
        schedule();
      }, 2400 + Math.random() * 3800);
    };
    schedule();
    return () => { alive = false; };
  }, [later]);

  // Idle behaviour
  useEffect(() => {
    let alive = true;
    const revert = (ms: number) =>
      later(() => { busy.current = false; setMood("soft"); }, ms);

    const act = () => {
      if (pausedRef.current || busy.current) return;
      busy.current = true;
      const roll = Math.random();
      if (roll < 0.18) { setState((s) => ({ ...s, gx: -1, gy: 0.05 })); revert(1300); }
      else if (roll < 0.36) { setState((s) => ({ ...s, gx: 1, gy: 0.05 })); revert(1300); }
      else if (roll < 0.52) { setState((s) => ({ ...s, gx: 0.2, gy: -1 })); revert(1500); }
      else if (roll < 0.62) { setState((s) => ({ ...s, gx: -0.4, gy: 0.6, lid: 0.3 })); revert(1400); }
      else if (roll < 0.72) { setMood("yawn"); revert(1900); }
      else if (roll < 0.82) { setMood("sleepy"); revert(3400); }
      else { setMood("happy"); revert(1800); }
    };

    const schedule = () => {
      later(() => {
        if (!alive) return;
        act();
        schedule();
      }, 3200 + Math.random() * 4800);
    };
    schedule();
    return () => { alive = false; };
  }, [later, setMood]);

  // Cleanup every timer on unmount
  useEffect(() => () => { timers.current.forEach(clearTimeout); }, []);

  /** Set a mood and hold it (blocking idle wandering) for `holdMs`. */
  const express = useCallback((mood: BobMood, holdMs = 5000) => {
    busy.current = true;
    setMood(mood);
    if (holdMs > 0) later(() => { busy.current = false; setMood("soft"); }, holdMs);
  }, [later, setMood]);

  return { ...state, setMood, express };
}