import { describe, expect, it } from "vitest";
import { confirmRead, createSightingLog } from "../src/readConfirm.js";

describe("confirmRead", () => {
  it("confirms a read only on its second matching sighting", () => {
    const log = createSightingLog();
    expect(confirmRead(log, "Z1E41HH0", 0)).toBe(false);
    expect(confirmRead(log, "Z1E41HH0", 120)).toBe(true);
    // Already confirmed: no second recording
    expect(confirmRead(log, "Z1E41HH0", 240)).toBe(false);
  });

  it("never confirms a one-off misread", () => {
    const log = createSightingLog();
    expect(confirmRead(log, "Z1E41HHO", 0)).toBe(false);
    expect(confirmRead(log, "Z1E41HH0", 120)).toBe(false);
    expect(confirmRead(log, "Z1E41HH0", 240)).toBe(true);
  });

  it("forgets sightings older than the window", () => {
    const log = createSightingLog();
    expect(confirmRead(log, "ABC12345", 0)).toBe(false);
    expect(confirmRead(log, "ABC12345", 5_000)).toBe(false);
    expect(confirmRead(log, "ABC12345", 5_100)).toBe(true);
  });
});
