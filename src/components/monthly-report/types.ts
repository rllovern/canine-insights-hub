export type Metrics = { impressions: number; clicks: number; cost: number; conversions: number };
export type Period = {
  total: Metrics;
  daily: Array<Metrics & { date: string }>;
  networks: Array<Metrics & { channel: string }>;
  campaigns: Array<Metrics & { name: string; channel: string; impressionShare: number | null }>;
};
export type MonthlyReportData = {
  property: { id: string; name: string; logo_url: string | null };
  month: string;
  prevMonth: string;
  range: { from: string; to: string };
  prevRange: { from: string; to: string };
  current: Period;
  previous: Period;
  adGroups: Array<Metrics & { name: string; campaign: string }>;
  ads: Array<Metrics & { adGroup: string; type: string; headlines: string[]; description: string | null; finalUrl: string | null }>;
  keywords: Array<Metrics & { text: string; matchType: string; qualityScore: number | null; adGroup: string }>;
  generatedAt: string;
};
