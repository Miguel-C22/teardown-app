import { describe, expect, it } from "vitest";
import { decideVerification, isHighValue, recommend } from "../src/recommend.js";
import { isNumberReadFromImage } from "../src/visionSchema.js";

describe("decideVerification", () => {
  it("verifies a barcode part number that matched a lookup", () => {
    const outcome = decideVerification({ identifiedBy: "barcode", partNumber: "0HW7NR", partNumberRead: true, serial: "CN0HW7NR", lookupMatched: true });
    expect(outcome).toEqual({ verified: true, reviewReasons: [] });
  });

  it("never verifies a part number the model did not read from the image", () => {
    const outcome = decideVerification({ identifiedBy: "label-read", partNumber: "M393A4K40DB3-CWE", partNumberRead: false, serial: "S1", lookupMatched: true });
    expect(outcome.verified).toBe(false);
  });

  it("never verifies a visual-only identification", () => {
    const outcome = decideVerification({ identifiedBy: "visual", partNumber: "M393A4K40DB3-CWE", partNumberRead: true, serial: null, lookupMatched: true });
    expect(outcome.verified).toBe(false);
    expect(outcome.reviewReasons).toContain("visual-only");
  });

  it("flags a part with no part number for a bench test", () => {
    const outcome = decideVerification({ identifiedBy: "visual", partNumber: null, partNumberRead: false, serial: null, lookupMatched: false });
    expect(outcome.reviewReasons).toEqual(["no-serial", "visual-only", "no-part-number", "needs-bench-test"]);
  });

  it("flags a read part number that no lookup source knows", () => {
    const outcome = decideVerification({ identifiedBy: "barcode", partNumber: "ABC123X", partNumberRead: true, serial: "S1", lookupMatched: false });
    expect(outcome).toEqual({ verified: false, reviewReasons: ["no-lookup-match"] });
  });
});

describe("recommend", () => {
  it("keeps verified parts at or above the keep minimum", () => {
    expect(recommend(true, 30)).toBe("KEEP");
  });

  it("recycles verified parts below the review minimum", () => {
    expect(recommend(true, 9)).toBe("RECYCLE");
  });

  it("sends borderline verified parts to review", () => {
    expect(recommend(true, 15)).toBe("REVIEW");
  });

  it("never recycles an unverified part, however cheap", () => {
    expect(recommend(false, 1)).toBe("REVIEW");
    expect(recommend(true, null)).toBe("REVIEW");
  });

  it("marks parts worth 100 or more as high value", () => {
    expect(isHighValue(100)).toBe(true);
    expect(isHighValue(99)).toBe(false);
    expect(isHighValue(null)).toBe(false);
  });
});

describe("isNumberReadFromImage", () => {
  const printedText = [
    { text: "M393A4K40DB3-CWE", kind: "partNumber" as const, readFromImage: true },
    { text: "S1AB", kind: "serial" as const, readFromImage: false },
  ];

  it("accepts a number the model marked as read", () => {
    expect(isNumberReadFromImage("M393A4K40DB3CWE", printedText)).toBe(true);
  });

  it("rejects a number marked as not legible", () => {
    expect(isNumberReadFromImage("S1AB", printedText)).toBe(false);
  });

  it("rejects a number that does not appear in the printed text at all", () => {
    expect(isNumberReadFromImage("HMA84GR7AFR4N", printedText)).toBe(false);
  });
});
