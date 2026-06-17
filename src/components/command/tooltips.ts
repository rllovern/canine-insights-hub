export const TIPS = {
  spend:
    "Total advertising investment across all paid channels (Google, Meta, etc.) for the selected period. Pulled from daily_metrics.cost. Lower spend with stable revenue is positive — delta arrow is inverted.",
  calls:
    "Total inbound phone calls tracked by CallTrackingMetrics (CTM) attributed to your campaigns in the selected period. One row per call.",
  qualifiedCalls:
    "Calls that passed lead-quality scoring as a real prospect (not spam, wrong number, or existing customer). Source: daily_metrics.good_leads. Higher is better.",
  appointments:
    "AI-projected sales (count) generated from qualified calls. Source: daily_metrics.projected_sale, derived from CTM transcript projections. Count only — never a dollar figure (revenue isn't attributable in this stack).",
  verifiedPending:
    "Verified sales come from GHL Won records. That feed is not yet piped into Command Center, so this stage shows pending until it is — count only, never dollars.",
  funnel:
    "Attributable customer journey: Ad Spend → Calls (CTM) → Qualified Calls (CTM scored) → AI-Projected Sale (CTM, count) → Verified Sale (GHL Won, count — pending). The % under each stage is its conversion from the previous stage. The funnel ends in counts because the close happens outside CTM tracking — revenue dollars aren't attributable here by design.",
  overallConv:
    "Appointments Set ÷ Calls Received. The share of every call that becomes a booked appointment. Industry healthy range: 15–25%.",
  cpl:
    "Ad Spend ÷ Calls Received. Cost to capture one attributable inbound call. Lower is better and the value is judged against the configured CPL target.",
  cpQualified:
    "Ad Spend ÷ Qualified Calls. What it costs you in media to produce one real prospect. Lower is better and the value is judged against the configured CPGL target.",
  cpAppt:
    "Ad Spend ÷ AI-Projected Sales. Marketing cost per projected appointment. Compare against your average ticket size to gauge ROI.",
  callHandling:
    "Answer rate, avg pickup time, abandon rate. Pending — CTM call-disposition feed is not yet ingested.",
  missedFollowUp:
    "Missed-call return rate and never-returned counts. Pending — these come from the same un-ingested CTM call-disposition feed as call handling.",
  callQuality:
    "AI call score and score distribution. Pending — these come from the same un-ingested CTM disposition/scoring feed as call handling.",
  topOpps:
    "Auto-detected gaps ranked by estimated cost saved (CPL/CPGL/SLA efficiency). Cost impact is attributable; revenue impact is not, so it's never shown as a dollar revenue figure.",
  portfolioVerdict:
    "One-glance state of the business: critical / warning / good counts per location, judged against CPL, qualified-call rate, and SLA targets.",
} as const;