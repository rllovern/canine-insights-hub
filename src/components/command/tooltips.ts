export const TIPS = {
  spend:
    "Total advertising investment across all paid channels (Google, Meta, etc.) for the selected period. Pulled from daily_metrics.cost. Lower spend with stable revenue is positive — delta arrow is inverted.",
  calls:
    "Total inbound phone calls tracked by CallTrackingMetrics (CTM) attributed to your campaigns in the selected period. One row per call.",
  qualifiedCalls:
    "Calls that passed lead-quality scoring as a real prospect (not spam, wrong number, or existing customer). Source: daily_metrics.good_leads. Higher is better.",
  appointments:
    "Booked appointments / projected sales generated from qualified calls in the period. Source: daily_metrics.projected_sale. This is the commitment-to-buy stage.",
  revenue:
    "Verified revenue collected from appointments that closed in the period. Source: daily_metrics.verified_sale. This is the bottom-line dollar outcome.",
  funnel:
    "End-to-end customer journey: Ad Spend → Calls → Qualified Calls → Appointments Set → Verified Revenue. The % under each stage is its conversion rate from the previous stage. Watch for the biggest drop — that's where revenue leaks.",
  overallConv:
    "Appointments Set ÷ Calls Received. The share of every call that becomes a booked appointment. Industry healthy range: 15–25%.",
  cpQualified:
    "Ad Spend ÷ Qualified Calls. What it costs you in media to produce one real prospect. Lower is better — green delta when it drops.",
  cpAppt:
    "Ad Spend ÷ Appointments Set. Marketing cost per booked appointment. Compare against average ticket size to gauge ROI.",
  cpRev:
    "Ad Spend ÷ Revenue Generated. The dollars of ad spend it took to produce $1 of revenue. Below $0.20 is excellent.",
  revenueCapture:
    "Weighted 0–100 score measuring how much of your potential revenue you actually captured. Weights: qualification (40%), appointment conversion (35%), revenue conversion (25%), with a 5pt floor. Green ≥75, amber 50–74, red <50.",
  revenueLost:
    "Estimated dollars left on the table this period. Calculation: (Qualified Calls × 60% target appointment rate × revenue per appointment) − actual revenue. Reflects the gap to a healthy benchmark.",
  callHandling:
    "How well calls are being answered: answer rate, average pickup time, and abandoned call rate. Currently using placeholder benchmarks until CTM disposition data is wired up.",
  missedFollowUp:
    "Speed of human follow-up for inbound leads. < 5 min response window dramatically improves conversion. Source: lead-performance speed-to-lead data.",
  callQuality:
    "Distribution of CTM call-score buckets in the period, mapped to a 1–5 quality scale. The center number is the weighted average score across all scored calls.",
  topOpps:
    "Auto-detected performance gaps ranked by estimated revenue lift if closed. Impact = (gap to industry benchmark) × downstream conversion × average revenue per appointment.",
} as const;