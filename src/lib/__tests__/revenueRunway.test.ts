import { describe, it, expect } from "vitest";
import { resolveTargetPeriod } from "@/lib/dateRange";
import { buildRunwaySeries } from "@/lib/verified-sales";

const D = (s: string) => new Date(s + "T12:00:00");

describe("resolveTargetPeriod", () => {
  it("thisMonth on July 10 2026 spans full calendar month", () => {
    const today = D("2026-07-10");
    const tp = resolveTargetPeriod(
      "thisMonth",
      { from: D("2026-07-01"), to: today },
      today,
    );
    expect(tp.targetPeriodStart.getDate()).toBe(1);
    expect(tp.targetPeriodEnd.getDate()).toBe(31);
    expect(tp.targetPeriodDays).toBe(31);
    expect(tp.elapsedDays).toBe(10);
    expect(tp.remainingDays).toBe(21);
    expect(tp.asOfDate).not.toBeNull();
  });

  it("lastMonth resolves to prior calendar month with remainingDays=0", () => {
    const today = D("2026-07-10");
    const tp = resolveTargetPeriod("lastMonth", { from: D("2026-06-01"), to: D("2026-06-30") }, today);
    expect(tp.targetPeriodDays).toBe(30);
    expect(tp.remainingDays).toBe(0);
    expect(tp.asOfDate?.getDate()).toBe(30);
  });

  it("custom July 1-10 is a deliberate 10-day target period", () => {
    const today = D("2026-07-10");
    const tp = resolveTargetPeriod("custom", { from: D("2026-07-01"), to: D("2026-07-10") }, today);
    expect(tp.targetPeriodDays).toBe(10);
    expect(tp.isCustomRange).toBe(true);
  });

  it("future custom period produces elapsedDays=0 and null asOfDate", () => {
    const today = D("2026-07-10");
    const tp = resolveTargetPeriod("custom", { from: D("2026-08-01"), to: D("2026-08-31") }, today);
    expect(tp.isFuture).toBe(true);
    expect(tp.asOfDate).toBeNull();
    expect(tp.elapsedDays).toBe(0);
    expect(tp.remainingDays).toBe(tp.targetPeriodDays);
  });
});

describe("buildRunwaySeries", () => {
  const baseArgs = {
    targetPeriodStart: D("2026-07-01"),
    targetPeriodDays: 31,
    elapsedDays: 10,
    remainingDays: 21,
    actualByDay: {
      "2026-07-01": 1000, "2026-07-02": 500, "2026-07-05": 2000, "2026-07-08": 1500,
    },
    target: 62000,
    closedRevenueToDate: 5000,
    projectedFutureRevenue: 8000,
    hasForecast: true,
  };

  it("target line reaches exactly the target on the final day and 1/N on day 1", () => {
    const s = buildRunwaySeries(baseArgs);
    expect(s[0].target).toBeCloseTo(62000 / 31, 6);
    expect(s[30].target).toBeCloseTo(62000, 6);
  });

  it("projection starts exactly at closedRevenueToDate and ends at closed+future", () => {
    const s = buildRunwaySeries(baseArgs);
    expect(s[9].projection).toBe(5000);
    expect(s[30].projection).toBeCloseTo(5000 + 8000, 6);
  });

  it("continuity: last actual equals closedRevenueToDate equals projection[boundary]", () => {
    const s = buildRunwaySeries(baseArgs);
    const lastActual = s[baseArgs.elapsedDays - 1].actual;
    expect(lastActual).toBe(baseArgs.closedRevenueToDate);
    expect(s[baseArgs.elapsedDays - 1].projection).toBe(lastActual);
  });

  it("actual is null after asOfDate", () => {
    const s = buildRunwaySeries(baseArgs);
    expect(s[10].actual).toBeNull();
    expect(s[30].actual).toBeNull();
  });

  it("target=0 (confirmed zero baseline) yields zero target line, not null", () => {
    const s = buildRunwaySeries({ ...baseArgs, target: 0 });
    expect(s.every((p) => p.target === 0)).toBe(true);
  });

  it("target=null hides the target series entirely", () => {
    const s = buildRunwaySeries({ ...baseArgs, target: null });
    expect(s.every((p) => p.target === null)).toBe(true);
  });

  it("future period (elapsedDays=0) yields empty actual and no projection", () => {
    const s = buildRunwaySeries({
      ...baseArgs,
      elapsedDays: 0,
      remainingDays: baseArgs.targetPeriodDays,
      hasForecast: false,
    });
    expect(s.every((p) => p.actual === null)).toBe(true);
    expect(s.every((p) => p.projection === null)).toBe(true);
  });
});