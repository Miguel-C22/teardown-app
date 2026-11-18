import { describe, expect, it } from "vitest";
import { checkScan, type ScanRecord } from "../src/dedup.js";

const NOW = 1_000_000;
const COOLDOWN = 3_000;

describe("checkScan", () => {
  it("returns 'new' for a serial never seen", () => {
    expect(checkScan([], "SN001", NOW, COOLDOWN)).toBe("new");
  });

  it("returns 'cooldown' when the same serial was scanned within the cooldown window", () => {
    const scans: ScanRecord[] = [{ serial: "SN001", scannedAt: NOW - 1_000 }];
    expect(checkScan(scans, "SN001", NOW, COOLDOWN)).toBe("cooldown");
  });

  it("returns 'duplicate' when the same serial was scanned but outside the cooldown window", () => {
    const scans: ScanRecord[] = [{ serial: "SN001", scannedAt: NOW - 10_000 }];
    expect(checkScan(scans, "SN001", NOW, COOLDOWN)).toBe("duplicate");
  });

  it("returns 'new' for a different serial even if others are in cooldown", () => {
    const scans: ScanRecord[] = [{ serial: "SN001", scannedAt: NOW - 500 }];
    expect(checkScan(scans, "SN002", NOW, COOLDOWN)).toBe("new");
  });

  it("handles 16 unique serials — all return 'new'", () => {
    const scans: ScanRecord[] = [];
    for (let index = 0; index < 16; index++) {
      const serial = `DIMM-${String(index).padStart(3, "0")}`;
      expect(checkScan(scans, serial, NOW + index * 10_000, COOLDOWN)).toBe("new");
      scans.push({ serial, scannedAt: NOW + index * 10_000 });
    }
    expect(scans).toHaveLength(16);
  });
});
