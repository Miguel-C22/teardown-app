import { PART_CATEGORIES, normalizeCategory, type PartCategory } from "./partCategory.js";

export interface CategoryCount {
  category: string;
  count: number;
}

export interface RemainingRow {
  category: PartCategory;
  expected: number;
  found: number;
}

// Several sweeps can overlap, so the expected count per category is the highest any single sweep saw
export function expectedCountsFromSweeps(sweeps: Array<{ countsByCategory: CategoryCount[] }>): Partial<Record<PartCategory, number>> {
  const expected: Partial<Record<PartCategory, number>> = {};
  for (const sweep of sweeps) {
    const perSweep: Partial<Record<PartCategory, number>> = {};
    for (const categoryCount of sweep.countsByCategory) {
      const category = normalizeCategory(categoryCount.category);
      perSweep[category] = (perSweep[category] ?? 0) + Math.max(0, Math.round(categoryCount.count));
    }
    for (const [category, count] of Object.entries(perSweep) as Array<[PartCategory, number]>) {
      expected[category] = Math.max(expected[category] ?? 0, count);
    }
  }
  return expected;
}

export function remainingByCategory(expected: Partial<Record<PartCategory, number>>, units: Array<{ partType: string }>): RemainingRow[] {
  const found: Partial<Record<PartCategory, number>> = {};
  for (const unit of units) {
    const category = normalizeCategory(unit.partType);
    found[category] = (found[category] ?? 0) + 1;
  }
  return PART_CATEGORIES
    .filter((category) => (expected[category] ?? 0) > 0 || (found[category] ?? 0) > 0)
    .map((category) => ({ category, expected: expected[category] ?? 0, found: found[category] ?? 0 }));
}

export function hasGaps(rows: RemainingRow[]): boolean {
  return rows.some((row) => row.found < row.expected);
}
