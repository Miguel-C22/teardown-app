import { describe, expect, it } from "vitest";
import { groupCodesIntoLabels, type DecodedCode } from "../src/labelGroup.js";

function code(text: string, x: number, y: number, width = 200, height = 40): DecodedCode {
  return { text, box: { x, y, width, height } };
}

describe("groupCodesIntoLabels", () => {
  it("joins a part number and serial stacked on one label into one part", () => {
    const labels = groupCodesIntoLabels([code("ST4000NM0035", 100, 100), code("ZC1ABC23", 100, 160)]);
    expect(labels).toHaveLength(1);
    expect(labels[0]).toMatchObject({ partNumber: "ST4000NM0035", serial: "ZC1ABC23", manufacturerHint: "Seagate", categoryHint: "HDD" });
  });

  it("keeps labels far apart as separate parts", () => {
    const labels = groupCodesIntoLabels([code("ZC1ABC23", 0, 0), code("ZC1ABC99", 900, 700)]);
    expect(labels).toHaveLength(2);
  });

  it("splits merged neighbouring labels so each serial is its own part", () => {
    const labels = groupCodesIntoLabels([
      code("M393A4K40DB3-CWE", 0, 0), code("S1AAA001", 0, 50),
      code("M393A4K40DB3-CWE", 230, 0), code("S1AAA002", 230, 50),
    ]);
    const serials = labels.map((label) => label.serial).sort();
    expect(serials).toEqual(["S1AAA001", "S1AAA002"]);
    expect(labels.every((label) => label.partNumber === "M393A4K40DB3-CWE")).toBe(true);
  });

  it("uses a Dell PPID as both part number source and serial", () => {
    const labels = groupCodesIntoLabels([code("CN0HW7NR7893153P0123A00", 0, 0)]);
    expect(labels[0]).toMatchObject({ partNumber: "0HW7NR", serial: "CN0HW7NR7893153P0123A00", manufacturerHint: "Dell" });
  });

  it("drops unreadable or irrelevant codes", () => {
    expect(groupCodesIntoLabels([code("https://dell.com/support", 0, 0)])).toEqual([]);
  });

  it("returns a label with no serial when only a part number is visible", () => {
    const labels = groupCodesIntoLabels([code("865414-B21", 0, 0)]);
    expect(labels[0]).toMatchObject({ partNumber: "865414-B21", serial: null });
  });
});
