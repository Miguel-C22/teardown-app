import { describe, expect, it } from "vitest";
import { expectedCountsFromSweeps, hasGaps, remainingByCategory } from "../src/remaining.js";

describe("expectedCountsFromSweeps", () => {
  it("takes the highest count any one sweep saw, so overlapping views don't double count", () => {
    const expected = expectedCountsFromSweeps([
      { countsByCategory: [{ category: "DIMM", count: 12 }, { category: "PSU", count: 2 }] },
      { countsByCategory: [{ category: "DIMM", count: 24 }, { category: "CPU", count: 2 }] },
    ]);
    expect(expected).toEqual({ DIMM: 24, PSU: 2, CPU: 2 });
  });

  it("folds NVMe into SSD and HBA into RAID", () => {
    expect(expectedCountsFromSweeps([{ countsByCategory: [{ category: "NVME", count: 2 }, { category: "SSD", count: 2 }, { category: "HBA", count: 1 }] }]))
      .toEqual({ SSD: 4, RAID: 1 });
  });
});

describe("remainingByCategory", () => {
  it("compares expected counts with recorded units", () => {
    const rows = remainingByCategory({ DIMM: 24, CPU: 2 }, [
      ...Array.from({ length: 16 }, () => ({ partType: "DIMM" })),
      { partType: "PSU" },
    ]);
    expect(rows).toEqual([
      { category: "DIMM", expected: 24, found: 16 },
      { category: "CPU", expected: 2, found: 0 },
      { category: "PSU", expected: 0, found: 1 },
    ]);
    expect(hasGaps(rows)).toBe(true);
  });

  it("reports no gaps once everything seen has been recorded", () => {
    expect(hasGaps(remainingByCategory({ PSU: 2 }, [{ partType: "PSU" }, { partType: "PSU" }]))).toBe(false);
  });
});
