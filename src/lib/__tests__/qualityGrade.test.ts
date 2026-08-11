import { describe, it, expect } from "vitest";
import { gradeQuality, wilsonInterval } from "@/lib/leadModel";

const counts = (good: number, total: number) => ({ bad: total - good, good, projected: 0 });

describe("gradeQuality", () => {
  it("suppresses below the low-sample floor", () => {
    expect(gradeQuality(counts(3, 7)).tier).toBe("low-sample");
  });

  it("grades 44% on 18 leads as good under the 30% benchmark", () => {
    expect(gradeQuality(counts(8, 18)).tier).toBe("green");
  });

  it("does not call a thin sample below target critical", () => {
    const g = gradeQuality(counts(3, 18));
    expect(g.tier).toBe("amber");
    expect(g.upper).toBeGreaterThan(0.25);
  });

  it("calls sustained underperformance red at volume", () => {
    expect(gradeQuality(counts(18, 120)).tier).toBe("red");
  });

  it("grades a just-under-target large sample amber", () => {
    expect(gradeQuality(counts(27, 100)).tier).toBe("amber");
  });

  it("grades a strong large sample green", () => {
    expect(gradeQuality(counts(40, 100)).tier).toBe("green");
  });

  it("narrows the interval as n grows", () => {
    const small = wilsonInterval(9, 18);
    const large = wilsonInterval(90, 180);
    expect(large.upper - large.lower).toBeLessThan(small.upper - small.lower);
  });
});
