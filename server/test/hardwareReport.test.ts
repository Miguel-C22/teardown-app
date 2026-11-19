import { readFileSync, rmSync } from "node:fs";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { parseHardwareReport } from "../src/hardwareReport.js";
import { resetDb } from "../src/store.js";

const TEST_DATA_DIRECTORY = "data/test-hardware";
const SAMPLE_REPORT = readFileSync("fixtures/hardware/sample-report.txt", "utf8");

beforeEach(() => {
  process.env.TEARDOWN_DATA_DIR = TEST_DATA_DIRECTORY;
  resetDb();
});

afterEach(() => {
  resetDb();
  rmSync(TEST_DATA_DIRECTORY, { recursive: true, force: true });
  delete process.env.TEARDOWN_DATA_DIR;
});

describe("parseHardwareReport", () => {
  it("reads drives from smartctl and memory from dmidecode, skipping empty slots", () => {
    const report = parseHardwareReport(SAMPLE_REPORT);
    expect(report.pairingCode).toBe("000000");
    expect(report.parts).toEqual([
      expect.objectContaining({ category: "HDD", partNumber: "ST2000DM001-1CH164", serial: "Z1E41HH0", description: "ST2000DM001-1CH164 2TB" }),
      expect.objectContaining({ category: "SSD", partNumber: "SAMSUNG MZQLB960HAJR-00007", serial: "S437NA0M123456" }),
      expect.objectContaining({ category: "DIMM", partNumber: "M393A4K40CB2-CTD", serial: "3A1B2C3D" }),
    ]);
    expect(report.parts[0].evidence).toContain("SMART passed");
    expect(report.parts[0].evidence).toContain("31876 power-on hours");
  });

  it("lists CPUs and cards without serials as sightings, ignoring empty sockets and onboard graphics", () => {
    expect(parseHardwareReport(SAMPLE_REPORT).sightings).toEqual([
      { category: "CPU", description: "Intel(R) Xeon(R) Gold 6130 CPU @ 2.10GHz" },
      { category: "NIC", description: "Intel Corporation Ethernet Controller X710 for 10GbE SFP+" },
      { category: "RAID", description: "Broadcom / LSI MegaRAID SAS-3 3108 [Invader]" },
    ]);
  });
});

describe("POST /api/hardware-reports", () => {
  it("confirms a drive the camera found and adds the parts it missed", async () => {
    const app = createApp();
    const session = (await request(app).post("/api/sessions").send({ assetTag: "SVR-HW-1" })).body;
    expect(session.pairingCode).toMatch(/^\d{6}$/);
    // The camera read only the serial of this drive
    await request(app).post(`/api/sessions/${session.id}/units`).send({ partType: "HDD", serial: "Z1E41HH0", identifiedBy: "barcode", evidence: "Z1E41HH0" });

    const report = SAMPLE_REPORT.replace("===PAIRING 000000", `===PAIRING ${session.pairingCode}`);
    const response = await request(app).post("/api/hardware-reports").set("Content-Type", "text/plain").send(report);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ matched: 1, added: 2, assetTag: "SVR-HW-1" });

    const stored = (await request(app).get(`/api/sessions/${session.id}`)).body;
    expect(stored.units).toHaveLength(3);
    const drive = stored.units.find((unit: { serial: string }) => unit.serial === "Z1E41HH0");
    expect(drive).toMatchObject({ identifiedBy: "hardware", partNumber: "ST2000DM001-1CH164", partType: "HDD" });
    expect(drive.evidence).toContain("camera:");
    const dimm = stored.units.find((unit: { serial: string }) => unit.serial === "3A1B2C3D");
    expect(dimm).toMatchObject({ identifiedBy: "hardware", partType: "DIMM", description: "Samsung 32GB DDR4 ECC RDIMM" });
  });

  it("rejects a report with no or an unknown pairing code", async () => {
    const app = createApp();
    const missing = await request(app).post("/api/hardware-reports").set("Content-Type", "text/plain").send("===SMARTCTL /dev/sda\n{}");
    expect(missing.status).toBe(400);
    const unknown = await request(app).post("/api/hardware-reports").set("Content-Type", "text/plain").send("===PAIRING 999999\n");
    expect(unknown.status).toBe(404);
  });
});
