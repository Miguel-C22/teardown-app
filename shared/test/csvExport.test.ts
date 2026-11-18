import { describe, expect, it } from "vitest";
import { buildCsv } from "../src/csvExport.js";

const session = { id: "sess-1", assetTag: "SVR-001", model: "PowerEdge R740" };

describe("buildCsv", () => {
  it("outputs a header row followed by one row per unit", () => {
    const units = [
      { partType: "HDD", serial: "WD123456", status: "ok", scannedAt: "2024-01-01T00:00:00.000Z" },
      { partType: "PSU", serial: "PSU-ABC", status: "ok", scannedAt: "2024-01-01T00:01:00.000Z" },
    ];
    const csv = buildCsv(session, units);
    const lines = csv.trim().split("\n");
    expect(lines).toHaveLength(3); // header + 2 data rows
    expect(lines[0]).toBe("sessionId,assetTag,model,partType,serial,status,quantity,scannedAt");
  });

  it("includes all required columns in each row", () => {
    const units = [{ partType: "HDD", serial: "WD999", status: "ok", scannedAt: "2024-01-01T00:00:00.000Z" }];
    const csv = buildCsv(session, units);
    const dataRow = csv.trim().split("\n")[1];
    expect(dataRow).toBe("sess-1,SVR-001,PowerEdge R740,HDD,WD999,ok,1,2024-01-01T00:00:00.000Z");
  });

  it("sets serial to empty string for no-serial units (review items)", () => {
    const units = [{ partType: "DIMM", serial: null, status: "review", scannedAt: "2024-01-01T00:00:00.000Z" }];
    const csv = buildCsv(session, units);
    const dataRow = csv.trim().split("\n")[1];
    expect(dataRow).toContain(",review,");
    expect(dataRow).toMatch(/DIMM,,review/);
  });

  it("produces 16 rows for 16 DIMM units (quantity 16 total)", () => {
    const units = Array.from({ length: 16 }, (_, index) => ({
      partType: "DIMM",
      serial: `DIMM-${String(index).padStart(3, "0")}`,
      status: "ok",
      scannedAt: "2024-01-01T00:00:00.000Z",
    }));
    const csv = buildCsv(session, units);
    const lines = csv.trim().split("\n");
    expect(lines).toHaveLength(17); // header + 16 rows
  });

  it("escapes commas inside field values", () => {
    const modelSession = { id: "s1", assetTag: "SVR-001", model: "Dell, Inc." };
    const units = [{ partType: "HDD", serial: "X1", status: "ok", scannedAt: "2024-01-01T00:00:00.000Z" }];
    const csv = buildCsv(modelSession, units);
    expect(csv).toContain('"Dell, Inc."');
  });
});
