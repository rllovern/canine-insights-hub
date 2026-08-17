/**
 * Location-aware quick questions for Bob.
 *
 * The chips name the place the user is actually looking at, rotate daily so the
 * panel never feels static, and stay stable while the drawer is open (the seed
 * is location + calendar day, not a random number).
 *
 * Year-over-year questions are intentionally absent: this business is compared
 * month over month only.
 */

export type PromptTheme = "volume" | "quality" | "spend" | "sales" | "change" | "watch";

interface Template {
  id: string;
  theme: PromptTheme;
  /** short chip label */
  label: (place: string) => string;
  /** full question sent to Bob */
  question: (place: string) => string;
  /** capability gate */
  needs?: "crm" | "ads";
}

const TEMPLATES: Template[] = [
  {
    id: "volume-now",
    theme: "volume",
    label: (p) => `How is ${p} doing?`,
    question: (p) => `How is ${p} doing over the selected date range?`,
  },
  {
    id: "volume-down",
    theme: "volume",
    label: () => "Why are my records down?",
    question: (p) => `Why are the records down for ${p}? Compare against the same span last month.`,
  },
  {
    id: "change-mom",
    theme: "change",
    label: () => "How does this compare to last month?",
    question: (p) => `How does ${p} compare to the same span last month?`,
  },
  {
    id: "change-what",
    theme: "change",
    label: () => "What changed recently?",
    question: (p) => `What changed for ${p} recently, and does it matter?`,
  },
  {
    id: "quality-rate",
    theme: "quality",
    label: () => "Are my calls good quality?",
    question: (p) => `Are the calls coming into ${p} good quality? Give me good leads against scored leads.`,
  },
  {
    id: "quality-mix",
    theme: "quality",
    label: () => "Where are my best calls coming from?",
    question: (p) => `Where are the best calls for ${p} coming from?`,
  },
  {
    id: "spend-working",
    theme: "spend",
    needs: "ads",
    label: () => "Is my ad spend working?",
    question: (p) => `Is the ad spend for ${p} working right now?`,
  },
  {
    id: "spend-pace",
    theme: "spend",
    needs: "ads",
    label: () => "Am I on pace with budget?",
    question: (p) => `Is ${p} on pace with its budget this month?`,
  },
  {
    id: "spend-cost",
    theme: "spend",
    needs: "ads",
    label: () => "What is a good lead costing me?",
    question: (p) => `What is a good lead costing me at ${p}, and is that reasonable?`,
  },
  {
    id: "sales-wins",
    theme: "sales",
    needs: "crm",
    label: () => "How are sales tracking?",
    question: (p) => `How are sales tracking for ${p} compared to last month?`,
  },
  {
    id: "sales-convert",
    theme: "sales",
    needs: "crm",
    label: () => "Are good leads turning into sales?",
    question: (p) => `Are good leads turning into sales at ${p}?`,
  },
  {
    id: "watch",
    theme: "watch",
    label: () => "Anything I should worry about?",
    question: (p) => `Is there anything at ${p} I should be worried about right now?`,
  },
  {
    id: "explain",
    theme: "watch",
    label: () => "What do these numbers mean?",
    question: (p) => `Explain what the numbers on this page mean for ${p} in plain English.`,
  },
];

export interface QuickPrompt {
  id: string;
  label: string;
  question: string;
}

export interface QuickPromptOptions {
  /** "Winchester", or "all locations" in agency scope */
  placeLabel?: string | null;
  hasCrm?: boolean;
  hasAds?: boolean;
  /** how many chips to show */
  count?: number;
  /** override the rotation seed (tests) */
  seed?: string;
}

function dayStamp(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/**
 * Pick `count` prompts, one per theme where possible, rotated by location + day.
 */
export function buildQuickPrompts(opts: QuickPromptOptions = {}): QuickPrompt[] {
  const place = (opts.placeLabel || "").trim() || "all locations";
  const hasCrm = opts.hasCrm !== false;
  const hasAds = opts.hasAds !== false;
  const count = opts.count ?? 4;
  const seed = hash(`${opts.seed ?? place}|${dayStamp()}`);

  const eligible = TEMPLATES.filter((t) =>
    t.needs === "crm" ? hasCrm : t.needs === "ads" ? hasAds : true,
  );

  // Group by theme so the four chips cover different ground.
  const themes: PromptTheme[] = ["volume", "change", "quality", "spend", "sales", "watch"];
  const byTheme = new Map<PromptTheme, Template[]>();
  for (const t of eligible) {
    byTheme.set(t.theme, [...(byTheme.get(t.theme) ?? []), t]);
  }

  const ordered = themes.filter((t) => (byTheme.get(t)?.length ?? 0) > 0);
  const start = ordered.length ? seed % ordered.length : 0;

  const picked: Template[] = [];
  // First pass: one from each theme, starting at a rotating offset.
  for (let i = 0; i < ordered.length && picked.length < count; i++) {
    const theme = ordered[(start + i) % ordered.length];
    const pool = byTheme.get(theme)!;
    picked.push(pool[seed % pool.length]);
  }
  // Second pass: backfill from anything left if we are still short.
  for (const t of eligible) {
    if (picked.length >= count) break;
    if (!picked.includes(t)) picked.push(t);
  }

  return picked.slice(0, count).map((t) => ({
    id: t.id,
    label: t.label(place),
    question: t.question(place),
  }));
}
