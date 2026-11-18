import { describe, expect, it } from "vitest";
import { normalizeCategory } from "../src/partCategory.js";

describe("normalizeCategory", () => {
  it.each([
    ["heatsink", "COOLING"],
    ["Cooler", "COOLING"],
    ["FAN", "COOLING"],
    ["motherboard", "BOARD"],
    ["riser", "BOARD"],
    ["backplane", "BOARD"],
    ["rails", "CHASSIS"],
    ["bezel", "CHASSIS"],
    ["caddy", "CHASSIS"],
    ["NVMe", "SSD"],
    ["hba", "RAID"],
    ["COOLING", "COOLING"],
  ])("groups %s under %s", (word, category) => {
    expect(normalizeCategory(word)).toBe(category);
  });

  it("puts anything unknown under OTHER so nothing is dropped", () => {
    expect(normalizeCategory("TPM module")).toBe("OTHER");
    expect(normalizeCategory(null)).toBe("OTHER");
  });
});
