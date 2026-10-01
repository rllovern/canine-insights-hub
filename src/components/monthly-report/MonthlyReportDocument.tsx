import { forwardRef, type ReactNode } from "react";
import { format, parseISO } from "date-fns";
import { ResponsiveContainer, ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Legend } from "recharts";
import logoWhite from "@/assets/ridgeside-logo-full-white.png";
import logo from "@/assets/ridgeside-logo-full.webp";
import type { Metrics, MonthlyReportData } from "./types";

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n < 100 ? 2 : 0 });
const int = (n: number) => Math.round(n).toLocaleString("en-US");
const pct = (n: number | null) => (n == null || !isFinite(n) ? "—" : `${(n * 100).toFixed(2)}%`);
const ctr = (m: Metrics) => (m.impressions ? m.clicks / m.impressions : 0);
const cpc = (m: Metrics) => (m.clicks ? m.cost / m.clicks : 0);
const cpa = (m: Metrics) => (m.conversions ? m.cost / m.conversions : 0);
const cvr = (m: Metrics) => (m.clicks ? m.conversions / m.clicks : 0);
const monthLabel = (ym: string) => format(parseISO(`${ym}-01`), "MMMM yyyy");
const CHANNEL: Record<string, string> = { SEARCH: "Search", DEMAND_GEN: "Demand Gen", DISPLAY: "Display", PERFORMANCE_MAX: "Performance Max", VIDEO: "Video", LOCAL_SERVICES: "Local Services" };
const MATCH: Record<string, string> = { EXACT: "Exact", PHRASE: "Phrase", BROAD: "Broad" };

function Delta({ cur, prev, invert = false }: { cur: number; prev: number; invert?: boolean }) {
  if (!prev) return <span className="rd-muted">—</span>;
  const d = (cur - prev) / prev;
  const good = invert ? d < 0 : d > 0;
  return <span className={good ? "rd-up" : "rd-down"}>{d > 0 ? "▲" : "▼"} {Math.abs(d * 100).toFixed(1)}%</span>;
}

function Page({ children, n, name, period }: { children: ReactNode; n: number; name: string; period: string }) {
  return (
    <div className="rd-page">
      <div className="mb-6 flex items-center justify-between">
        <img src={logo} alt="Ridgeside K9" className="h-8 w-auto" crossOrigin="anonymous" />
        <div className="text-right text-[11px] rd-muted">{name}<br />{period}</div>
      </div>
      {children}
      <div className="rd-foot"><span>Ridgeside K9 · Google Ads Performance Report</span><span>Page {n}</span></div>
    </div>
  );
}

function QS({ v }: { v: number | null }) {
  const cls = v == null ? "rd-qs-na" : v >= 8 ? "rd-qs-hi" : v >= 5 ? "rd-qs-mid" : "rd-qs-lo";
  return <span className={`rd-qs ${cls}`}>{v ?? "–"}</span>;
}

function summary(d: MonthlyReportData): string[] {
  const c = d.current.total, p = d.previous.total;
  const ch = (a: number, b: number) => (b ? ((a - b) / b) * 100 : null);
  const out: string[] = [];
  const cl = ch(c.clicks, p.clicks);
  if (cl != null) out.push(`Clicks ${cl >= 0 ? "increased" : "decreased"} ${Math.abs(cl).toFixed(1)}% month over month (${int(p.clicks)} → ${int(c.clicks)}).`);
  const cv = ch(c.conversions, p.conversions);
  if (cv != null) out.push(`Conversions ${cv >= 0 ? "rose" : "fell"} ${Math.abs(cv).toFixed(1)}% to ${c.conversions.toFixed(0)}, with cost per conversion at ${usd(cpa(c))}.`);
  out.push(`Click-through rate was ${pct(ctr(c))} versus ${pct(ctr(p))} last month — a direct signal of ad relevance and search intent match.`);
  const q = d.keywords.filter((k) => k.qualityScore != null);
  if (q.length) {
    const avg = q.reduce((s, k) => s + (k.qualityScore ?? 0), 0) / q.length;
    const hi = q.filter((k) => (k.qualityScore ?? 0) >= 8).length;
    out.push(`Average Quality Score across top keywords is ${avg.toFixed(1)}/10; ${hi} of ${q.length} rated keywords score 8 or higher.`);
  }
  const best = d.current.campaigns[0];
  if (best) out.push(`"${best.name.replace(/:SystemGenerated:.*/, "")}" drove the most clicks (${int(best.clicks)}) at ${usd(cpc(best))} per click.`);
  return out;
}

export const MonthlyReportDocument = forwardRef<HTMLDivElement, { data: MonthlyReportData }>(function MonthlyReportDocument({ data: d }, ref) {
  const name = d.property.name;
  const period = `${format(parseISO(d.range.from), "MMM d")} – ${format(parseISO(d.range.to), "MMM d, yyyy")}`;
  const c = d.current.total, p = d.previous.total;
  const pp = { name, period };
  const kpis: Array<[string, string, string, number, number, boolean?]> = [
    ["Impressions", int(c.impressions), int(p.impressions), c.impressions, p.impressions],
    ["Clicks", int(c.clicks), int(p.clicks), c.clicks, p.clicks],
    ["CTR", pct(ctr(c)), pct(ctr(p)), ctr(c), ctr(p)],
    ["Avg. CPC", usd(cpc(c)), usd(cpc(p)), cpc(c), cpc(p), true],
    ["Conversions", c.conversions.toFixed(0), p.conversions.toFixed(0), c.conversions, p.conversions],
    ["Conv. Rate", pct(cvr(c)), pct(cvr(p)), cvr(c), cvr(p)],
    ["Cost / Conv.", usd(cpa(c)), usd(cpa(p)), cpa(c), cpa(p), true],
    ["Spend", usd(c.cost), usd(p.cost), c.cost, p.cost],
  ];
  const daily = d.current.daily.map((x) => ({ ...x, day: format(parseISO(x.date), "MMM d") }));

  return (
    <div ref={ref} className="report-doc flex flex-col items-center gap-6">
      {/* 1 Cover */}
      <div className="rd-page rd-cover flex flex-col justify-between">
        <img src={logoWhite} alt="Ridgeside K9" className="h-14 w-auto self-start" crossOrigin="anonymous" />
        <div>
          <div className="rd-kicker">Monthly Performance Report</div>
          <h1 className="mt-4 text-5xl font-bold leading-tight">Google Ads Paid Search<br />&amp; Performance Report</h1>
          <div className="mt-8 text-2xl font-semibold">{name}</div>
          <div className="mt-2 text-lg opacity-80">{monthLabel(d.month)} · {period}</div>
          <div className="mt-1 text-sm opacity-70">Compared with {monthLabel(d.prevMonth)}</div>
        </div>
        <div className="text-xs opacity-70">Prepared by Ridgeside K9 · Generated {format(parseISO(d.generatedAt), "MMM d, yyyy")}</div>
      </div>

      {/* 2 Executive summary */}
      <Page n={2} {...pp}>
        <div className="rd-kicker">Executive Summary</div>
        <h2 className="rd-h mb-5">Month-over-Month Scorecard</h2>
        <div className="grid grid-cols-4 gap-3">
          {kpis.map(([label, cv, pv, a, b, inv]) => (
            <div key={label} className="rd-card p-3">
              <div className="text-[10px] font-bold uppercase tracking-wider rd-muted">{label}</div>
              <div className="mt-1 text-xl font-bold">{cv}</div>
              <div className="mt-1 flex justify-between text-[10px]"><span className="rd-muted">Prev {pv}</span><Delta cur={a} prev={b} invert={inv} /></div>
            </div>
          ))}
        </div>
        <div className="rd-card rd-soft mt-6 p-5">
          <div className="mb-2 text-sm font-bold">Key Takeaways</div>
          <ul className="list-disc space-y-2 pl-5 text-[13px] leading-relaxed">
            {summary(d).map((s) => <li key={s}>{s}</li>)}
          </ul>
        </div>
        <h3 className="mb-2 mt-6 text-base font-bold">Performance by Network</h3>
        <table className="rd-t">
          <thead><tr><th>Network</th><th className="rd-num">Impr.</th><th className="rd-num">Clicks</th><th className="rd-num">CTR</th><th className="rd-num">Avg CPC</th><th className="rd-num">Conv.</th><th className="rd-num">Spend</th><th className="rd-num">Share of Spend</th></tr></thead>
          <tbody>
            {d.current.networks.sort((a, b) => b.cost - a.cost).map((n) => (
              <tr key={n.channel}><td>{CHANNEL[n.channel] ?? n.channel}</td><td className="rd-num">{int(n.impressions)}</td><td className="rd-num">{int(n.clicks)}</td><td className="rd-num">{pct(ctr(n))}</td><td className="rd-num">{usd(cpc(n))}</td><td className="rd-num">{n.conversions.toFixed(0)}</td><td className="rd-num">{usd(n.cost)}</td><td className="rd-num">{pct(c.cost ? n.cost / c.cost : 0)}</td></tr>
            ))}
          </tbody>
        </table>
      </Page>

      {/* 3 Timeline */}
      <Page n={3} {...pp}>
        <div className="rd-kicker">Trend</div>
        <h2 className="rd-h mb-5">Daily Clicks vs. Impressions</h2>
        <div className="rd-card p-4" style={{ height: 420 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={daily}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 16% 88%)" />
              <XAxis dataKey="day" tick={{ fontSize: 10 }} interval={Math.ceil(daily.length / 10)} />
              <YAxis yAxisId="l" tick={{ fontSize: 10 }} />
              <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 10 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar yAxisId="r" dataKey="impressions" name="Impressions" fill="hsl(222 35% 82%)" isAnimationActive={false} />
              <Line yAxisId="l" dataKey="clicks" name="Clicks" stroke="hsl(354 70% 45%)" strokeWidth={2.5} dot={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-6 grid grid-cols-3 gap-3 text-[12px]">
          {(() => {
            const best = [...daily].sort((a, b) => b.clicks - a.clicks)[0];
            const days = daily.length || 1;
            return (<>
              <div className="rd-card p-4"><div className="rd-muted text-[10px] font-bold uppercase">Avg. daily clicks</div><div className="text-xl font-bold">{(c.clicks / days).toFixed(1)}</div></div>
              <div className="rd-card p-4"><div className="rd-muted text-[10px] font-bold uppercase">Avg. daily spend</div><div className="text-xl font-bold">{usd(c.cost / days)}</div></div>
              <div className="rd-card p-4"><div className="rd-muted text-[10px] font-bold uppercase">Best day</div><div className="text-xl font-bold">{best ? `${best.day} · ${int(best.clicks)}` : "—"}</div></div>
            </>);
          })()}
        </div>
      </Page>

      {/* 4 Campaigns */}
      <Page n={4} {...pp}>
        <div className="rd-kicker">Campaigns</div>
        <h2 className="rd-h mb-5">Top Campaigns</h2>
        <table className="rd-t" style={{ fontSize: 10 }}>
          <thead><tr><th>Campaign</th><th>Type</th><th className="rd-num">Clicks</th><th className="rd-num">Impr.</th><th className="rd-num">CTR</th><th className="rd-num">Avg CPC</th><th className="rd-num">Conv.</th><th className="rd-num">Search IS</th><th className="rd-num">Spend</th></tr></thead>
          <tbody>
            {d.current.campaigns.filter((x) => x.impressions > 0).slice(0, 18).map((x) => {
              const prev = d.previous.campaigns.find((y) => y.name === x.name);
              return (
                <tr key={x.name}><td className="font-semibold" style={{ maxWidth: 210, wordBreak: "break-word" }}>{x.name.replace(/:SystemGenerated:.*/, "")}{prev && <div className="text-[9px] font-normal"><Delta cur={x.clicks} prev={prev.clicks} /> clicks MoM</div>}</td><td>{CHANNEL[x.channel] ?? x.channel}</td><td className="rd-num">{int(x.clicks)}</td><td className="rd-num">{int(x.impressions)}</td><td className="rd-num">{pct(ctr(x))}</td><td className="rd-num">{usd(cpc(x))}</td><td className="rd-num">{x.conversions.toFixed(0)}</td><td className="rd-num">{pct(x.impressionShare)}</td><td className="rd-num">{usd(x.cost)}</td></tr>
              );
            })}
          </tbody>
        </table>
      </Page>

      {/* 5 Ad groups */}
      <Page n={5} {...pp}>
        <div className="rd-kicker">Ad Groups</div>
        <h2 className="rd-h mb-5">Top Ad Groups</h2>
        <table className="rd-t">
          <thead><tr><th>Ad Group</th><th>Campaign</th><th className="rd-num">Clicks</th><th className="rd-num">Impr.</th><th className="rd-num">CTR</th><th className="rd-num">Avg CPC</th><th className="rd-num">Conv.</th><th className="rd-num">Spend</th></tr></thead>
          <tbody>
            {d.adGroups.map((x, i) => (
              <tr key={i}><td className="font-semibold">{x.name}</td><td className="rd-muted">{x.campaign}</td><td className="rd-num">{int(x.clicks)}</td><td className="rd-num">{int(x.impressions)}</td><td className="rd-num">{pct(ctr(x))}</td><td className="rd-num">{usd(cpc(x))}</td><td className="rd-num">{x.conversions.toFixed(0)}</td><td className="rd-num">{usd(x.cost)}</td></tr>
            ))}
          </tbody>
        </table>
      </Page>

      {/* 6 Ads */}
      <Page n={6} {...pp}>
        <div className="rd-kicker">Creative</div>
        <h2 className="rd-h mb-5">Top Performing Ads</h2>
        <div className="grid grid-cols-2 gap-3">
          {d.ads.slice(0, 8).map((a, i) => (
            <div key={i} className="rd-card p-3">
              <div className="text-[9px] rd-muted">Ad · {a.finalUrl?.replace(/^https?:\/\//, "").slice(0, 40) ?? a.adGroup}</div>
              <div className="mt-1 text-[13px] font-bold leading-snug" style={{ color: "hsl(var(--rd-navy))" }}>{a.headlines.length ? a.headlines.join(" | ") : a.type.replace(/_/g, " ").toLowerCase()}</div>
              {a.description && <div className="mt-1 text-[10px] leading-snug rd-muted">{a.description}</div>}
              <div className="mt-2 flex justify-between border-t pt-2 text-[10px]" style={{ borderColor: "hsl(var(--rd-line))" }}>
                <span><b>{int(a.clicks)}</b> clicks</span><span><b>{pct(ctr(a))}</b> CTR</span><span><b>{a.conversions.toFixed(0)}</b> conv.</span>
              </div>
            </div>
          ))}
        </div>
      </Page>

      {/* 7 Keywords */}
      <Page n={7} {...pp}>
        <div className="rd-kicker">Search Intent &amp; Quality</div>
        <h2 className="rd-h mb-2">Top Keywords</h2>
        <div className="mb-3 flex gap-4 text-[10px] rd-muted">
          <span><span className="rd-qs rd-qs-hi">8+</span> High quality</span><span><span className="rd-qs rd-qs-mid">5–7</span> Average</span><span><span className="rd-qs rd-qs-lo">1–4</span> Below average</span>
        </div>
        <table className="rd-t">
          <thead><tr><th>Keyword</th><th>Match</th><th className="rd-num">QS</th><th className="rd-num">Clicks</th><th className="rd-num">Impr.</th><th className="rd-num">CTR</th><th className="rd-num">Avg CPC</th><th className="rd-num">Conv.</th></tr></thead>
          <tbody>
            {d.keywords.slice(0, 22).map((k, i) => (
              <tr key={i}><td className="font-semibold">{k.text}</td><td>{MATCH[k.matchType] ?? k.matchType}</td><td className="rd-num"><QS v={k.qualityScore} /></td><td className="rd-num">{int(k.clicks)}</td><td className="rd-num">{int(k.impressions)}</td><td className="rd-num">{pct(ctr(k))}</td><td className="rd-num">{usd(cpc(k))}</td><td className="rd-num">{k.conversions.toFixed(0)}</td></tr>
            ))}
          </tbody>
        </table>
      </Page>
    </div>
  );
});
