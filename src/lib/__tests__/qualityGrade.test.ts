import { describe, it, expect } from "vitest";
import { gradeQuality, wilsonInterval } from "@/lib/leadModel";

const counts = (good: number, total: number) => ({ bad: total - good, good, projected: 0 });

describe("gradeQuality", () => {
  it("suppresses below the low-sample floor", () => {
    expect(gradeQuality(counts(3, 7)).tier).toBe("low-sample");
  });

  it("does not call 44% critical on 18 leads", () => {
    const g = gradeQuality(counts(8, 18));
    expect(g.tier).toBe("amber");
    expect(g.upper).toBeGreaterThan(0.45);
  });

  it("calls sustained underperformance red at volume", () => {
    expect(gradeQuality(counts(36, 120)).tier).toBe("red");
  });

  it("grades a strong large sample green", () => {
    expect(gradeQuality(counts(60, 100)).tier).toBe("green");
  });

  it("narrows the interval as n grows", () => {
    const small = wilsonInterval(9, 18);
    const large = wilsonInterval(90, 180);
    expect(large.upper - large.lower).toBeLessThan(small.upper - small.lower);
  });
});
