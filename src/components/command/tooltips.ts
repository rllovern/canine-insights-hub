export const TIPS = {
  spend:
    "Total advertising investment across all paid channels (Google, Meta, etc.) for the selected period. Pulled from daily_metrics.cost. Lower spend with stable revenue is positive — delta arrow is inverted.",
  calls:
    "Records = calls + forms (the superset). No Entry, Spam, Bad, Good, and AI-projected are slices INSIDE Records, never added on top. Source: v_lead_counts_daily.records (daily_metrics.record_count).",
  qualifiedCalls:
    "Good leads — real, workable prospects (not spam, wrong number, or existing customer). Source: daily_metrics.good_leads. Parallel quality tier to AI-projected sale (neither is inside the other). Higher is better.",
  appointments:
    "AI-projected sale — a separate quality tier the CTM transcript flagged as high conviction. NOT a forecast, pipeline, or revenue proxy; never multiplied by ticket size. Source: daily_metrics.projected_sale. Counts toward the quality rate alongside good leads.",
  verifiedPending:
    "Verified sales come from GHL Won records. That feed is not yet piped into Command Center, so this stage shows pending until it is — count only, never dollars.",
  funnel:
    "Attributable customer journey: Ad Spend → Records (calls + forms, the superset) → two parallel quality tiers (Good leads & AI-projected sale, both scored from CTM transcripts — neither is inside the other) → Verified Sale (GHL Won, pending). No Entry / Spam / Bad / Good / AI-projected are slices INSIDE Records, never added on top. Total Leads = bad + good + AI-projected. Quality = (good + AI-projected) ÷ total. Counts only — revenue dollars aren't attributable here by design.",
  overallConv:
    "Appointments Set ÷ Records. The share of records that becomes a booked appointment. Industry healthy range: 15–25%.",
  cpl:
    "Ad Spend ÷ Total Leads (bad + good + AI-projected). Lower is better; judged against the configured CPL target.",
  cpQualified:
    "Ad Spend ÷ (good + AI-projected) — cost per quality lead. Same numerator as the quality metric. Lower is better; judged against the configured CPGL target.",
  cpAppt:
    "Ad Spend ÷ AI-projected sales (count). Cost per AI-projected sale. AI-projected is a quality signal — do not read this as cost-per-sale or ROI.",
  qualityRate:
    "Quality = (good + AI-projected) ÷ (bad + good + AI-projected). Target: ≥55% green, 45–54% amber, <45% red. Winchester (≈50%) is shown as a benchmark reference line, not the pass/fail threshold.",
  callHandling:
    "Answer rate, avg pickup time, abandon rate. Pending — CTM call-disposition feed is not yet ingested.",
  missedFollowUp:
    "Missed-call return rate and never-returned counts. Pending — these come from the same un-ingested CTM call-disposition feed as call handling.",
  callQuality:
    "AI call score and score distribution. Pending — these come from the same un-ingested CTM disposition/scoring feed as call handling.",
  topOpps:
    "Auto-detected gaps ranked by severity across CPL/CPGL/SLA efficiency. Dollar impact stays pending until the cost-impact formula is anchored to stable verified source counts and unit costs.",
  portfolioVerdict:
    "One-glance state of the business per location, judged on the canonical quality rate = (good + AI-projected) ÷ total leads. Target ≥55% green, 45–54% amber, <45% red. Locations with fewer than 25 leads in window show as low-sample, not red.",
  adSpend:
    "Google PPC spend over the selected date range. Source: daily_metrics.cost where ad_source = 'Google PPC'.",
  adCpl:
    "Ad CPL = PPC spend ÷ PPC total leads (bad + good + AI-projected) over the selected date range. No absolute pass/fail target until unit economics exist — compare locations against Winchester's efficiency instead.",
  adCpgl:
    "Ad CPGL = PPC spend ÷ PPC quality leads (good + AI-projected) over the selected date range. Winchester benchmark $338/good lead is a reference line, NOT a pass/fail threshold.",
  mediaEfficiency:
    "Media Efficiency Ratio = total (blended) leads ÷ PPC leads. The dilution factor — how much non-paid lead volume is layered on top of paid. Higher = more leverage from organic/direct/referral.",
} as const;