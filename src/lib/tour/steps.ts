import type { AppRole } from "@/lib/types";

/** Roles that can see the full internal navigation. */
export const STAFF_ROLES: AppRole[] = ["super_admin", "admin"];
/** Every role the tour supports. */
export const ALL_TOUR_ROLES: AppRole[] = ["super_admin", "admin", "owner", "location_owner"];

export type TourStep = {
  /** Stable id. */
  id: string;
  /** Route the tour must be on for this step. */
  route: string;
  /** CSS selector for the element to spotlight. Omit for a centered "screen" step. */
  target?: string;
  title: string;
  /** Plain-English body copy. Keep it short and simple. */
  body: string;
  /** Optional extra "what to do" line. */
  action?: string;
  /** Roles this step applies to. Defaults to every tour role. */
  roles?: AppRole[];
};

const t = (s: string) => `[data-tour="${s}"]`;

export const TOUR_KEY = "dashboard-v1";

export function stepsForRole(role: AppRole | null | undefined): TourStep[] {
  return TOUR_STEPS.filter((s) => !s.roles || (role ? s.roles.includes(role) : false));
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: "welcome",
    route: "/command",
    title: "Welcome to your dashboard",
    body: "This dashboard shows how your advertising is doing: how many people reached out, how many were real customers, and how many bought.",
    action: "Click Next and I'll show you around. It takes about two minutes.",
  },
  {
    id: "sidebar",
    route: "/command",
    target: t("sidebar"),
    title: "The menu",
    body: "Every page of the dashboard lives here on the left. Click a name to go to that page.",
  },
  {
    id: "scope",
    route: "/command",
    target: t("scope-selector"),
    title: "Pick a location",
    body: "This is where you choose which location you are looking at, or all of them at once.",
    action: "Everything on the screen changes to match what you pick here.",
  },
  {
    id: "daterange",
    route: "/command",
    target: t("date-range"),
    title: "Pick a time period",
    body: "This sets the dates. For example, Last 30 Days means every number below covers the last 30 days.",
    action: "If a number looks wrong, check this first — it may just be the wrong dates.",
  },
  {
    id: "kpis",
    route: "/command",
    target: t("command-kpis"),
    title: "Your four big numbers",
    body: "These cards are the quick health check: money spent, people who reached out, the good ones, and the ones who bought.",
    action: "The small line inside each card shows the day-by-day trend.",
  },
  {
    id: "kpi-spend",
    route: "/command",
    target: t("kpi-spend"),
    title: "Ad Spend",
    body: "How much money was spent on ads in the dates you picked. Green or red shows whether it went up or down compared to the period before.",
  },
  {
    id: "kpi-records",
    route: "/command",
    target: t("kpi-records"),
    title: "Records",
    body: "Every person who reached out — calls and form fills together. This includes wrong numbers and junk.",
  },
  {
    id: "kpi-qualified",
    route: "/command",
    target: t("kpi-qualified"),
    title: "Qualified (Good Leads)",
    body: "Out of everyone who reached out, these are the real potential customers. This is the number that matters most day to day.",
  },
  {
    id: "kpi-sales",
    route: "/command",
    target: t("kpi-sales"),
    title: "Verified Sale",
    body: "Deals that actually closed and were marked Won in the CRM.",
    action: "Click this card any time to see the full list of sales.",
  },
  {
    id: "funnel",
    route: "/command",
    target: t("command-funnel"),
    title: "The customer journey",
    body: "This shows people moving from first contact, to good lead, to sale. Where the bar drops off sharply is where you are losing business.",
  },
  {
    id: "verdict",
    route: "/command",
    target: t("command-verdict"),
    title: "The verdict",
    body: "A plain-English read on whether things are on track, plus what to look at next. Start here if you only have 30 seconds.",
  },
  {
    id: "sales-nav",
    route: "/command",
    target: t("nav-sales"),
    title: "Next: Sale Records",
    body: "This menu item opens the list of everything that sold.",
    action: "Click Next and we'll go there.",
  },
  {
    id: "sales-heatmap",
    route: "/sales",
    target: t("sales-heatmap"),
    title: "Sales cadence",
    body: "A calendar of your sales. Darker squares mean more sales that day. Empty squares mean nothing sold.",
    action: "Click any day to see exactly who bought that day.",
  },
  {
    id: "sales-runway",
    route: "/sales",
    target: t("sales-runway"),
    title: "Revenue runway",
    body: "Money earned so far, adding up over time. The dotted line is the target you should be tracking toward.",
    action: "If your line is under the dotted line, you're behind for the period.",
  },
  {
    id: "sales-table",
    route: "/sales",
    target: t("sales-table"),
    title: "The sales list",
    body: "Every sale with the customer's name, phone, email, when they came in, when they bought, and how much for.",
    action: "Use Export CSV to open the same list in a spreadsheet.",
  },
  {
    id: "lead-perf",
    roles: STAFF_ROLES,
    route: "/lead-performance",
    target: t("page-root"),
    title: "Lead Performance",
    body: "This page is about how fast and how often your team follows up. Slow follow-up is the number one reason leads go cold.",
    action: "Look for leads that were never answered — those are lost money.",
  },
  {
    id: "calls",
    roles: STAFF_ROLES,
    route: "/calls",
    target: t("page-root"),
    title: "Call Tracking",
    body: "Where your calls came from and how they were graded. It also shows which source produced actual sales.",
  },
  {
    id: "keywords",
    roles: STAFF_ROLES,
    route: "/keywords",
    target: t("page-root"),
    title: "Keywords",
    body: "The words people typed into Google before they found you. Useful for spotting words that cost money but never lead to customers.",
  },
  {
    id: "budget",
    route: "/budget",
    target: t("page-root"),
    title: "Budget Pacing",
    body: "Your monthly budget versus what has actually been spent. It tells you if you're spending too fast, too slow, or just right for this point in the month.",
  },
  {
    id: "reports",
    roles: STAFF_ROLES,
    route: "/reports",
    target: t("page-root"),
    title: "Reports",
    body: "Build a clean summary you can share with a client. Pick the location and dates, then share the link.",
  },
  {
    id: "assistant",
    roles: STAFF_ROLES,
    route: "/command",
    target: t("bob-launcher"),
    title: "Bob, your assistant",
    body: "Ask questions in normal words, like \"how many good leads did Nova get last month?\" and he answers using your real data. He lives behind this button in the bottom-right corner of every page.",
  },
  {
    id: "finish",
    route: "/command",
    title: "That's the whole tour",
    body: "Remember the two controls at the top — location and dates. They control every number you see.",
    action: "You can run this tour again any time with the Help button at the top right.",
  },
];
