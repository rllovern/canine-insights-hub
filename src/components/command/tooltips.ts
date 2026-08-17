export const TIPS = {
  spend:
    "Total advertising investment across all paid channels (Google, Meta, etc.) for the selected period. Pulled from daily_metrics.cost. Lower spend with stable revenue is positive — delta arrow is inverted.",
  calls:
    "Population: every record. Records = calls + forms (the superset). No Entry, Spam, Bad and Good are slices INSIDE Records, never added on top. Source: v_lead_counts_daily.records.",
  qualifiedCalls:
    "Population: good leads. Real, workable prospects scored good by call tracking — not spam, wrong number, or an existing customer. Source: daily_metrics.good_leads. Higher is better.",
  appointments:
    "Population: CRM wins. Deals marked Won in the CRM, counted on the date they were marked. Separate from call scoring and never folded into the quality rate.",
  verifiedPending:
    "Verified sales come from GHL Won records. That feed is not yet piped into Command Center, so this stage shows pending until it is — count only, never dollars.",
  funnel:
    "Attributable customer journey: Ad Spend → Records (every call + form) → Scored Leads (the ones call tracking gave a quality outcome; spam and un-scored records drop out here) → Good Leads. Quality = good ÷ scored leads. Verified Sale (CRM wins) is counted separately, on its own date. Counts only — revenue dollars aren't attributable here by design.",
  overallConv:
    "Appointments Set ÷ Records. The share of records that becomes a booked appointment. Industry healthy range: 15–25%.",
  cpl:
    "Ad Spend ÷ scored leads. Lower is better; judged against the configured CPL target.",
  cpQualified:
    "Ad Spend ÷ good leads — cost per good lead. Same numerator as the quality rate. Lower is better; judged against the configured CPGL target.",
  cpAppt:
    "Ad Spend ÷ CRM wins (count). Cost per verified sale.",
  qualityRate:
    "Quality = good leads ÷ scored leads. Target: ≥30% green, 25–29% amber, <25% red. The benchmark reference follows the current location or all-location scope and active mode; it is not the pass/fail threshold.",
  callHandling:
    "Answer rate, avg pickup time, abandon rate. Pending — CTM call-disposition feed is not yet ingested.",
  missedFollowUp:
    "Missed-call return rate and never-returned counts. Pending — these come from the same un-ingested CTM call-disposition feed as call handling.",
  callQuality:
    "AI call score and score distribution. Pending — these come from the same un-ingested CTM disposition/scoring feed as call handling.",
  topOpps:
    "Auto-detected gaps ranked by severity across CPL/CPGL/SLA efficiency. Dollar impact stays pending until the cost-impact formula is anchored to stable verified source counts and unit costs.",
  portfolioVerdict:
    "One-glance state of the business per location, judged on the canonical quality rate = good leads ÷ scored leads. Target ≥30% green, 25–29% amber, <25% red (graded on the Wilson interval, so thin samples are not called critical). The mix breakdown counts call-scoring outcomes. 'Verified sales' are closed/won deals from the CRM and are a separate figure.",
  adSpend:
    "Google PPC spend over the selected date range. Source: daily_metrics.cost where ad_source = 'Google PPC'.",
  adCpl:
    "Ad CPL = PPC spend ÷ PPC scored leads over the selected date range. No absolute pass/fail target until unit economics exist — compare against the current location or all-location scope instead.",
  adCpgl:
    "Ad CPGL = PPC spend ÷ PPC good leads over the selected date range. The current location or all-location scope is the reference benchmark, NOT a pass/fail threshold.",
  mediaEfficiency:
    "Media Efficiency Ratio = blended scored leads ÷ PPC scored leads. The dilution factor — how much non-paid volume is layered on top of paid. Higher = more leverage from organic/direct/referral.",
} as const;