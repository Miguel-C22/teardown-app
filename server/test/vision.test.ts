import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { rmSync } from "node:fs";
import { createApp } from "../src/app.js";
import { resetDb } from "../src/store.js";

const TEST_DATA_DIRECTORY = "data/test-vision";
// A 1x1 JPEG is enough: in mock mode the reading comes from the fixture, not the pixels
const TINY_JPEG_BASE64 = "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";

beforeEach(() => {
  delete process.env.EBAY_CLIENT_ID;
  process.env.TEARDOWN_DATA_DIR = TEST_DATA_DIRECTORY;
  resetDb();
  rmSync(TEST_DATA_DIRECTORY, { recursive: true, force: true });
});

afterEach(() => {
  resetDb();
  rmSync(TEST_DATA_DIRECTORY, { recursive: true, force: true });
  delete process.env.TEARDOWN_DATA_DIR;
});

async function startSession(app: ReturnType<typeof createApp>): Promise<string> {
  const response = await request(app).post("/api/sessions").send({ assetTag: "SVR-VISION", model: "PowerEdge R740" });
  return (response.body as { id: string }).id;
}

describe("GET /api/health", () => {
  it("reports the vision mode", async () => {
    const response = await request(createApp()).get("/api/health");
    expect(response.body.visionMode).toBe("mock");
  });
});

describe("POST /api/sessions/:id/units with part numbers", () => {
  it("looks up the part number, not the serial, and stores the value on the unit", async () => {
    const app = createApp();
    const sessionId = await startSession(app);
    const response = await request(app).post(`/api/sessions/${sessionId}/units`)
      .send({ partType: "AUTO", partNumber: "0HW7NR", serial: "CN0HW7NR7893153P0123A00", identifiedBy: "barcode" });
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      partType: "PSU", partNumber: "0HW7NR", description: "Dell 1100W Platinum PSU", priceMax: 80,
      lookupSource: "catalog", verified: true, recommendation: "KEEP", identifiedBy: "barcode", reviewReasons: [],
    });
  });

  it("returns the existing unit for a serial already recorded in the session", async () => {
    const app = createApp();
    const sessionId = await startSession(app);
    await request(app).post(`/api/sessions/${sessionId}/units`).send({ partType: "HDD", serial: "ZC1ABC23" });
    const second = await request(app).post(`/api/sessions/${sessionId}/units`).send({ partType: "HDD", serial: "zc1abc23" });
    expect(second.status).toBe(200);
    expect(second.body.duplicate).toBe(true);
    const session = await request(app).get(`/api/sessions/${sessionId}`);
    expect(session.body.units).toHaveLength(1);
  });

  it("keeps an unknown part number unverified and in review", async () => {
    const app = createApp();
    const sessionId = await startSession(app);
    const response = await request(app).post(`/api/sessions/${sessionId}/units`).send({ partType: "OTHER", partNumber: "ZZ-NOT-A-PART", serial: "S123456" });
    expect(response.body).toMatchObject({ verified: false, recommendation: "REVIEW", reviewReasons: ["no-lookup-match"] });
  });
});

describe("GET /api/lookup", () => {
  it("returns the source and recommendation for a catalog part number", async () => {
    const response = await request(createApp()).get("/api/lookup?q=ST4000NM0035");
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ source: "catalog", partType: "HDD", recommendation: "KEEP" });
  });

  it("no longer matches unrelated text through catch-all prefixes", async () => {
    const response = await request(createApp()).get("/api/lookup?q=STRING123");
    expect(response.status).toBe(404);
  });
});

describe("POST /api/sessions/:id/vision/sweep", () => {
  it("returns detected parts with legible numbers and the session's what's-left counts", async () => {
    const app = createApp();
    const sessionId = await startSession(app);
    const response = await request(app).post(`/api/sessions/${sessionId}/vision/sweep`).send({ image: TINY_JPEG_BASE64 });
    expect(response.status).toBe(200);
    expect(response.body.mode).toBe("mock");
    expect(response.body.parts).toHaveLength(6);

    const [psu, dimm, cpu] = response.body.parts as Array<Record<string, unknown>>;
    expect(psu).toMatchObject({ partNumber: "0HW7NR", serial: "CN0HW7NR7893153P0123A00", duplicate: false });
    expect(psu.unitId).toEqual(expect.any(String));
    expect(dimm).toMatchObject({ partNumber: "M393A4K40CB2-CTD", serial: null, unitId: null, needsCloseUp: true });
    expect(cpu).toMatchObject({ partNumber: null, unitId: null });

    expect(response.body.session.remaining).toEqual(expect.arrayContaining([
      { category: "PSU", expected: 2, found: 1 },
      { category: "DIMM", expected: 12, found: 0 },
      { category: "CPU", expected: 2, found: 0 },
    ]));
  });

  it("doesn't add the same PSU twice when the same view is swept again", async () => {
    const app = createApp();
    const sessionId = await startSession(app);
    await request(app).post(`/api/sessions/${sessionId}/vision/sweep`).send({ image: TINY_JPEG_BASE64 });
    const second = await request(app).post(`/api/sessions/${sessionId}/vision/sweep`).send({ image: TINY_JPEG_BASE64 });
    expect(second.body.parts[0].duplicate).toBe(true);
    expect(second.body.session.units).toHaveLength(1);
    expect(second.body.session.sweepCount).toBe(2);
  });

  it("counts vision calls per session", async () => {
    const app = createApp();
    const sessionId = await startSession(app);
    await request(app).post(`/api/sessions/${sessionId}/vision/sweep`).send({ image: TINY_JPEG_BASE64 });
    await request(app).post(`/api/sessions/${sessionId}/vision/closeup`).send({ image: TINY_JPEG_BASE64 });
    const session = await request(app).get(`/api/sessions/${sessionId}`);
    expect(session.body.visionUsage.calls).toBe(2);
  });

  it("returns 404 for an unknown session", async () => {
    const response = await request(createApp()).post("/api/sessions/nope/vision/sweep").send({ image: TINY_JPEG_BASE64 });
    expect(response.status).toBe(404);
  });
});

describe("POST /api/sessions/:id/vision/closeup", () => {
  it("records a label-read unit with evidence and the kept photo", async () => {
    const app = createApp();
    const sessionId = await startSession(app);
    const response = await request(app).post(`/api/sessions/${sessionId}/vision/closeup`).send({ image: TINY_JPEG_BASE64 });
    expect(response.status).toBe(200);
    expect(response.body.unit).toMatchObject({
      partType: "DIMM", partNumber: "M393A4K40CB2-CTD", serial: "S1AB2C3D", identifiedBy: "label-read",
      verified: true, lookupSource: "catalog", recommendation: "KEEP",
    });
    expect(response.body.unit.evidence).toContain("M393A4K40CB2-CTD");
    expect(response.body.unit.photoPath).toMatch(/\.jpg$/);
    const photo = await request(app).get(`/api/photos/${response.body.unit.photoPath as string}`);
    expect(photo.status).toBe(200);
  });

  it("records an unreadable part as visual-only, needing a bench test", async () => {
    const app = createApp();
    const sessionId = await startSession(app);
    const response = await request(app).post(`/api/sessions/${sessionId}/vision/closeup`).send({ image: TINY_JPEG_BASE64, fixture: "unreadable" });
    expect(response.body.unit).toMatchObject({ partType: "CPU", partNumber: null, identifiedBy: "visual", verified: false, recommendation: "REVIEW" });
    expect(response.body.unit.reviewReasons).toEqual(expect.arrayContaining(["visual-only", "needs-bench-test"]));
  });

  it("never verifies a part number the model did not read from the image", async () => {
    const app = createApp();
    const sessionId = await startSession(app);
    const response = await request(app).post(`/api/sessions/${sessionId}/vision/closeup`).send({ image: TINY_JPEG_BASE64, fixture: "invented" });
    expect(response.body.unit).toMatchObject({ partNumber: null, verified: false, identifiedBy: "visual" });
    expect(response.body.unit.evidence).toContain("unconfirmed part number MZ7LH960HAJR-00005");
  });

  it("rejects an unknown fixture name", async () => {
    const app = createApp();
    const sessionId = await startSession(app);
    const response = await request(app).post(`/api/sessions/${sessionId}/vision/closeup`).send({ image: TINY_JPEG_BASE64, fixture: "missing" });
    expect(response.status).toBe(400);
  });
});

describe("GET /api/photos/:fileName", () => {
  it("refuses paths outside the photo folder", async () => {
    const response = await request(createApp()).get("/api/photos/..%2F..%2Fpackage.json");
    expect(response.status).toBe(404);
  });
});

describe("CSV export", () => {
  it("includes the identification and value columns", async () => {
    const app = createApp();
    const sessionId = await startSession(app);
    await request(app).post(`/api/sessions/${sessionId}/vision/closeup`).send({ image: TINY_JPEG_BASE64 });
    const csv = await request(app).get(`/api/sessions/${sessionId}/export.csv`);
    expect(csv.text).toContain("M393A4K40CB2-CTD,Samsung");
    expect(csv.text).toContain(",label-read,yes,");
  });
});

describe("a label read in two goes", () => {
  it("adds the serial to the drive recorded a moment earlier with only its model number", async () => {
    const app = createApp();
    const sessionId = await startSession(app);
    await request(app).post(`/api/sessions/${sessionId}/units`).send({ partType: "AUTO", partNumber: "ST2000DM001", serial: null });
    const second = await request(app).post(`/api/sessions/${sessionId}/units`).send({ partType: "AUTO", partNumber: "ST2000DM001", serial: "Z1E41HH0" });
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ filledIn: true, serial: "Z1E41HH0", partNumber: "ST2000DM001", status: "ok" });
    const session = await request(app).get(`/api/sessions/${sessionId}`);
    expect(session.body.units).toHaveLength(1);
  });

  it("adds the part number to a unit first recorded by its serial alone", async () => {
    const app = createApp();
    const sessionId = await startSession(app);
    await request(app).post(`/api/sessions/${sessionId}/units`).send({ partType: "AUTO", serial: "ZC1ABC23" });
    const second = await request(app).post(`/api/sessions/${sessionId}/units`).send({ partType: "AUTO", partNumber: "ST4000NM0035", serial: "ZC1ABC23" });
    expect(second.body).toMatchObject({ filledIn: true, partNumber: "ST4000NM0035", partType: "HDD", verified: true });
    const session = await request(app).get(`/api/sessions/${sessionId}`);
    expect(session.body.units).toHaveLength(1);
  });
});

describe("parts identified by appearance", () => {
  it("records a CPU cooler with no label as cooling, priced from the AI estimate", async () => {
    const app = createApp();
    const sessionId = await startSession(app);
    const response = await request(app).post(`/api/sessions/${sessionId}/vision/closeup`).send({ image: TINY_JPEG_BASE64, fixture: "cooler" });
    expect(response.body.unit).toMatchObject({
      partType: "COOLING", manufacturer: "SilverStone", description: "SilverStone XE02-SP5B 2U SP5 CPU cooler",
      priceMin: 40, priceMax: 70, lookupSource: "ai-estimate", verified: false, recommendation: "REVIEW",
    });
  });

  it("counts coolers and fans in the what's-left checklist", async () => {
    const app = createApp();
    const sessionId = await startSession(app);
    const response = await request(app).post(`/api/sessions/${sessionId}/vision/sweep`).send({ image: TINY_JPEG_BASE64 });
    expect(response.body.session.remaining).toEqual(expect.arrayContaining([{ category: "COOLING", expected: 8, found: 0 }]));
  });

  it("prices an unreadable part from the AI's estimate and keeps it in review", async () => {
    const app = createApp();
    const sessionId = await startSession(app);
    const response = await request(app).post(`/api/sessions/${sessionId}/vision/closeup`).send({ image: TINY_JPEG_BASE64, fixture: "unreadable" });
    expect(response.body.unit).toMatchObject({
      partNumber: null, priceMin: 30, priceMax: 150, lookupSource: "ai-estimate", verified: false, recommendation: "REVIEW",
    });
  });

  it("shows a price for sweep parts that have no readable part number", async () => {
    const app = createApp();
    const sessionId = await startSession(app);
    const response = await request(app).post(`/api/sessions/${sessionId}/vision/sweep`).send({ image: TINY_JPEG_BASE64 });
    const cpu = (response.body.parts as Array<{ category: string; lookup: Record<string, unknown> | null }>).find((part) => part.category === "CPU");
    expect(cpu?.lookup).toMatchObject({ source: "ai-estimate", priceMin: 40, priceMax: 120, name: "Intel Xeon Gold 6130" });
  });

  it("add by look carries the price, and a description price never verifies the part", async () => {
    const app = createApp();
    const sessionId = await startSession(app);
    const response = await request(app).post(`/api/sessions/${sessionId}/units`).send({
      partType: "CPU", serial: null, manufacturer: "Intel", description: "Xeon Scalable under heatsink", identifiedBy: "visual",
      searchQuery: "Intel Xeon Gold 6130", estimatedPriceUsd: { low: 40, high: 120 },
    });
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      description: "Intel Xeon Gold 6130", priceMin: 40, priceMax: 120, lookupSource: "ai-estimate", verified: false, recommendation: "REVIEW",
    });
    expect(response.body.reviewReasons).toEqual(expect.arrayContaining(["visual-only", "needs-bench-test"]));
  });
});

describe("model from the sweep", () => {
  it("fills an empty model from the chassis guess", async () => {
    const app = createApp();
    const created = await request(app).post("/api/sessions").send({ assetTag: "SVR-NO-MODEL" });
    await request(app).post(`/api/sessions/${created.body.id}/vision/sweep`).send({ image: TINY_JPEG_BASE64 });
    const summary = await request(app).get(`/api/sessions/${created.body.id}`);
    expect(summary.body.model).toBe("Dell PowerEdge R740");
  });

  it("never overwrites a model that is already set", async () => {
    const app = createApp();
    const created = await request(app).post("/api/sessions").send({ assetTag: "SVR-HAS-MODEL", model: "PowerEdge R640" });
    await request(app).post(`/api/sessions/${created.body.id}/vision/sweep`).send({ image: TINY_JPEG_BASE64 });
    const summary = await request(app).get(`/api/sessions/${created.body.id}`);
    expect(summary.body.model).toBe("PowerEdge R640");
  });
});
