import { describe, expect, it } from "vitest";
import { mergeWalkFrame, type WalkablePart } from "../src/walkMerge.js";

const dimm = (index: number, serial: string | null = null): WalkablePart => ({ index, category: "DIMM", serial, partNumber: null, searchQuery: "32GB DDR4 RDIMM" });
const fan = (index: number): WalkablePart => ({ index, category: "COOLING", serial: null, partNumber: null, familyGuess: "hot-swap fan module" });

describe("mergeWalkFrame", () => {
  it("adds everything from the first frame", () => {
    const result = mergeWalkFrame([], [], [dimm(0), dimm(1), fan(2)]);
    expect(result.parts).toHaveLength(3);
    expect(result.addedCount).toBe(3);
  });

  it("the same view seen again adds nothing", () => {
    const first = mergeWalkFrame([], [], [dimm(0), dimm(1), fan(2)]);
    const second = mergeWalkFrame(first.parts, first.frameIndexes, [dimm(0), dimm(1), fan(2)]);
    expect(second.parts).toHaveLength(3);
    expect(second.addedCount).toBe(0);
  });

  it("moving along adds only the parts that came into view", () => {
    const first = mergeWalkFrame([], [], [dimm(0), dimm(1), dimm(2), dimm(3)]);
    // The four DIMMs from the last frame are still in view and one more has come into view
    const second = mergeWalkFrame(first.parts, first.frameIndexes, [dimm(0), dimm(1), dimm(2), dimm(3), dimm(4)]);
    expect(second.parts).toHaveLength(5);
    expect(second.addedCount).toBe(1);
  });

  it("a serial seen earlier on the walk is never added twice, even frames later", () => {
    const first = mergeWalkFrame([], [], [dimm(0, "S1"), fan(1)]);
    const second = mergeWalkFrame(first.parts, first.frameIndexes, [fan(0)]);
    const third = mergeWalkFrame(second.parts, second.frameIndexes, [dimm(0, "S1")]);
    expect(third.parts.filter((part) => part.serial === "S1")).toHaveLength(1);
  });

  it("unlabelled parts not in the previous frame count as new (approximate, may over-count on a revisit)", () => {
    const first = mergeWalkFrame([], [], [fan(0)]);
    const second = mergeWalkFrame(first.parts, first.frameIndexes, [dimm(0)]);
    const third = mergeWalkFrame(second.parts, second.frameIndexes, [fan(0)]);
    expect(third.parts.filter((part) => part.category === "COOLING")).toHaveLength(2);
  });

  it("gives every merged part a unique index", () => {
    const first = mergeWalkFrame([], [], [dimm(0), fan(1)]);
    const second = mergeWalkFrame(first.parts, first.frameIndexes, [{ ...dimm(0), category: "PSU", searchQuery: "PSU" }]);
    expect(new Set(second.parts.map((part) => part.index)).size).toBe(second.parts.length);
  });
});
