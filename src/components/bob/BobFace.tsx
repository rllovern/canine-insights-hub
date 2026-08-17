import { CSSProperties } from "react";

export type BobMood =
  | "happy" | "soft" | "thinking" | "curious" | "concerned" | "sleepy" | "yawn";

type MoodSpec = {
  gx: number; gy: number; lid: number; tilt: number;
  bl: string; br: string; mouth: keyof typeof MOUTHS;
};

export const MOODS: Record<BobMood, MoodSpec> = {
  happy:     { gx: 0, gy: 0, lid: 0, tilt: -8, bl: "rotate(-20deg) translateY(-4px)", br: "rotate(12deg) translateY(-5px)", mouth: "grin" },
  soft:      { gx: 0, gy: 0, lid: 0, tilt: -3, bl: "rotate(-12deg) translateY(-2px)", br: "rotate(8deg) translateY(-3px)", mouth: "smile" },
  thinking:  { gx: -0.55, gy: -1, lid: 0.16, tilt: -6, bl: "rotate(10deg) translateY(1px)", br: "rotate(-18deg) translateY(-6px)", mouth: "hmm" },
  curious:   { gx: 0.45, gy: -0.25, lid: 0, tilt: 3, bl: "rotate(-4deg)", br: "rotate(18deg) translateY(-7px)", mouth: "o" },
  concerned: { gx: 0, gy: 0.5, lid: 0.22, tilt: 2, bl: "rotate(16deg) translateY(-2px)", br: "rotate(-16deg) translateY(-2px)", mouth: "frown" },
  sleepy:    { gx: 0.1, gy: 0.45, lid: 0.68, tilt: 4, bl: "rotate(-2deg) translateY(2px)", br: "rotate(2deg) translateY(2px)", mouth: "tiny" },
  yawn:      { gx: 0, gy: -0.35, lid: 0.92, tilt: -4, bl: "translateY(-5px)", br: "translateY(-6px)", mouth: "yawn" },
};

const MOUTHS = {
  grin:  { w: 54, h: 26, cres: true, tongue: true, r: "", dx: 0, dy: 0 },
  smile: { w: 40, h: 14, cres: true, tongue: true, r: "", dx: 0, dy: 0 },
  hmm:   { w: 14, h: 5, cres: false, tongue: false, r: "4px", dx: 7, dy: 0 },
  o:     { w: 15, h: 16, cres: false, tongue: false, r: "50%", dx: 0, dy: 0 },
  frown: { w: 26, h: 9, cres: false, tongue: false, r: "26px 26px 8px 8px", dx: 0, dy: 4 },
  tiny:  { w: 11, h: 7, cres: false, tongue: false, r: "50%", dx: 0, dy: 0 },
  yawn:  { w: 25, h: 30, cres: false, tongue: true, r: "48%", dx: 0, dy: 0 },
};

export const BOB_STATUS: Record<BobMood, string> = {
  happy: "Happy to help",
  soft: "Your numbers, in plain English",
  thinking: "Thinking…",
  curious: "Good question!",
  concerned: "Hmm, one sec",
  sleepy: "Getting a little sleepy…",
  yawn: "…yawn… I'm up!",
};

const GAZE_T = "transform .55s cubic-bezier(.3,1.2,.4,1)";

type Props = {
  scale?: number;
  mood: BobMood;
  gx: number;
  gy: number;
  lid: number;
};

/**
 * Bob himself — a fully CSS/SVG rendered character. Everything is derived
 * from the `--bob` design token so he re-themes with the app.
 */
export function BobFace({ scale = 1, mood, gx, gy, lid }: Props) {
  const M = MOODS[mood] ?? MOODS.happy;
  const c = "hsl(var(--bob))";
  const navy = `color-mix(in oklab, ${c} 42%, black)`;
  const dark = `color-mix(in oklab, ${c} 28%, black)`;
  const grad = `radial-gradient(circle at 31% 24%, color-mix(in oklab, ${c} 42%, white) 0%, ${c} 42%, color-mix(in oklab, ${c} 78%, black) 100%)`;
  const mo = MOUTHS[M.mouth] ?? MOUTHS.smile;

  const eye = (left: string, top: string, w: number, h: number, iris: number) => (
    <div
      style={{
        position: "absolute", left, top, width: w, height: h, borderRadius: "50%",
        background: "#fff",
        boxShadow: "inset 0 -3px 5px rgba(20,50,140,.25), 0 2px 5px rgba(10,30,90,.3)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute", left: "50%", top: "50%", width: iris, height: iris,
          borderRadius: "50%",
          background: `radial-gradient(circle at 38% 32%, #7FB6FF 0%, #2F6FE0 45%, ${navy} 100%)`,
          boxShadow: `inset 0 0 0 1.5px ${navy}`,
          transform: `translate(calc(-50% + ${gx * 4}px), calc(-50% + ${gy * 4}px))`,
          transition: GAZE_T,
        }}
      >
        <div style={{ position: "absolute", left: "27%", top: "27%", width: "46%", height: "46%", borderRadius: "50%", background: "#0B1030" }} />
        <div style={{ position: "absolute", right: "12%", top: "10%", width: "28%", height: "28%", borderRadius: "50%", background: "rgba(255,255,255,.95)" }} />
      </div>
      <div
        style={{
          position: "absolute", left: "-8%", right: "-8%", top: "-6%",
          height: `${lid * 108}%`,
          background: `linear-gradient(${c}, color-mix(in oklab, ${c} 82%, black))`,
          borderRadius: "0 0 50% 50%",
          transition: "height .13s ease",
        }}
      />
    </div>
  );

  const brow = (pos: CSSProperties, tf: string, mirror: boolean) => (
    <div style={{ position: "absolute", ...pos, transform: tf, transition: "transform .35s cubic-bezier(.3,1.2,.4,1)" }}>
      <svg
        viewBox="0 0 24 14" width={24} height={14}
        style={{ display: "block", overflow: "visible", transform: mirror ? "scaleX(-1)" : "none", filter: "drop-shadow(0 2px 1.5px rgba(8,20,70,.4))" }}
      >
        <path d="M3 11 Q9 1.5 21.5 6" stroke={navy} strokeWidth={5.5} fill="none" strokeLinecap="round" />
      </svg>
    </div>
  );

  return (
    <div style={{ width: 100 * scale, height: 100 * scale, position: "relative" }}>
      <div style={{ position: "absolute", bottom: -9, left: "8%", width: "84%", height: 13, borderRadius: "50%", background: "radial-gradient(ellipse, rgba(10,25,80,.32), transparent 68%)", filter: "blur(2px)" }} />
      <div style={{ animation: "bobBounce 3.2s cubic-bezier(.34,1.3,.5,1) infinite", transformOrigin: "50% 100%" }}>
        <div
          style={{
            position: "relative", width: 100, height: 100,
            transform: `scale(${scale}) rotate(${M.tilt + gx * 7}deg)`,
            transformOrigin: "top left",
            transition: GAZE_T,
          }}
        >
          <div
            style={{
              position: "absolute", inset: 0, borderRadius: "50%", background: grad,
              boxShadow: `0 16px 30px color-mix(in oklab, ${c} 40%, transparent), inset 0 -16px 24px rgba(8,20,70,.35), inset 10px 8px 20px rgba(255,255,255,.18)`,
            }}
          />
          <div style={{ position: "absolute", top: 7, left: 17, width: 34, height: 19, borderRadius: "50%", background: "rgba(255,255,255,.5)", filter: "blur(3px)", transform: "rotate(-20deg)" }} />

          <div style={{ position: "absolute", inset: 0, transform: `translate(${gx * 8}px, ${gy * 6}px)`, transition: GAZE_T }}>
            {brow({ left: 21, top: 13 }, M.bl, false)}
            {brow({ right: 21, top: 10 }, M.br, true)}
            {eye("19px", "26px", 30, 33, 17)}
            {eye("51px", "26px", 30, 33, 17)}

            <div
              style={{
                position: "absolute", left: "50%", top: 61,
                transform: `translateX(calc(-50% + ${mo.dx}px)) translateY(${mo.dy}px)`,
                transition: "all .35s cubic-bezier(.3,1.2,.4,1)",
              }}
            >
              {mo.cres ? (
                <div style={{ position: "relative", width: mo.w, height: mo.h, overflow: "hidden", transition: "all .35s cubic-bezier(.3,1.2,.4,1)" }}>
                  <div
                    style={{
                      position: "absolute", left: 0, top: -mo.h * 0.5, width: "100%", height: mo.h * 1.5,
                      borderRadius: "50%",
                      background: `linear-gradient(${dark}, color-mix(in oklab, ${dark} 60%, black))`,
                      boxShadow: "inset 0 5px 7px rgba(0,0,0,.5)",
                    }}
                  >
                    {mo.tongue && (
                      <div
                        style={{
                          position: "absolute", bottom: -5, left: "50%", transform: "translateX(-50%)",
                          width: mo.w * 0.62, height: mo.h * 0.85, borderRadius: "50%",
                          background: "radial-gradient(circle at 40% 28%, #F28A7C, #D8493C)",
                          boxShadow: "inset 0 3px 4px rgba(120,20,10,.5)",
                        }}
                      />
                    )}
                  </div>
                  <div
                    style={{
                      position: "absolute", left: "-20%", top: -mo.h * 1.22, width: "140%", height: mo.h * 1.55,
                      borderRadius: "50%", background: c,
                      boxShadow: "0 2px 2px rgba(255,255,255,.18), 0 1px 1px rgba(0,0,0,.12)",
                    }}
                  />
                </div>
              ) : (
                <div
                  style={{
                    width: mo.w, height: mo.h, borderRadius: mo.r,
                    background: `linear-gradient(${dark}, color-mix(in oklab, ${dark} 65%, black))`,
                    overflow: "hidden", position: "relative",
                    boxShadow: "inset 0 3px 5px rgba(0,0,0,.45)",
                    transition: "all .35s cubic-bezier(.3,1.2,.4,1)",
                  }}
                >
                  {mo.tongue && (
                    <div
                      style={{
                        position: "absolute", bottom: -3, left: "50%", transform: "translateX(-50%)",
                        width: mo.w * 0.7, height: mo.h * 0.5, borderRadius: "50%",
                        background: "radial-gradient(circle at 40% 28%, #F28A7C, #D8493C)",
                      }}
                    />
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default BobFace;