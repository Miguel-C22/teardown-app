import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { unlinkSync, existsSync } from "node:fs";
import { createApp } from "../src/app.js";
import { resetDb } from "../src/store.js";

const TEST_DB = "data/teardown.db";

beforeEach(() => {
  if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
  resetDb();
});

afterEach(() => {
  resetDb();
  if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
});

describe("POST /api/sessions", () => {
  it("creates a session and returns it", async () => {
    const app = createApp();
    const response = await request(app).post("/api/sessions").send({ assetTag: "SVR-001", model: "PowerEdge R740" });
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ assetTag: "SVR-001", model: "PowerEdge R740" });
    expect(typeof response.body.id).toBe("string");
  });

  it("returns 400 when assetTag is missing", async () => {
    const app = createApp();
    const response = await request(app).post("/api/sessions").send({ model: "PowerEdge R740" });
    expect(response.status).toBe(400);
  });

  it("starts a session from the scanned tag alone, with the model left for the sweep to fill", async () => {
    const app = createApp();
    const response = await request(app).post("/api/sessions").send({ assetTag: "SVR-001" });
    expect(response.status).toBe(201);
    expect(response.body.model).toBe("");
  });
});

describe("GET /api/sessions/:id", () => {
  it("returns the session with an empty units array", async () => {
    const app = createApp();
    const created = await request(app).post("/api/sessions").send({ assetTag: "SVR-002", model: "ProLiant DL380" });
    const { id } = created.body as { id: string };

    const response = await request(app).get(`/api/sessions/${id}`);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id, assetTag: "SVR-002", units: [] });
  });

  it("returns 404 for an unknown session", async () => {
    const app = createApp();
    const response = await request(app).get("/api/sessions/does-not-exist");
    expect(response.status).toBe(404);
  });
});

describe("POST /api/sessions/:id/units", () => {
  it("adds a unit to an existing session", async () => {
    const app = createApp();
    const sess = await request(app).post("/api/sessions").send({ assetTag: "SVR-003", model: "R630" });
    const { id } = sess.body as { id: string };

    const unitResponse = await request(app)
      .post(`/api/sessions/${id}/units`)
      .send({ partType: "HDD", serial: "WD123456" });
    expect(unitResponse.status).toBe(201);
    expect(unitResponse.body).toMatchObject({ sessionId: id, partType: "HDD", serial: "WD123456", status: "ok" });
  });

  it("sets status to 'review' for no-serial units", async () => {
    const app = createApp();
    const sess = await request(app).post("/api/sessions").send({ assetTag: "SVR-004", model: "R630" });
    const { id } = sess.body as { id: string };

    const unitResponse = await request(app)
      .post(`/api/sessions/${id}/units`)
      .send({ partType: "DIMM", serial: null });
    expect(unitResponse.status).toBe(201);
    expect(unitResponse.body).toMatchObject({ status: "review" });
  });

  it("returns 404 when the session does not exist", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/sessions/no-such-session/units")
      .send({ partType: "HDD", serial: "X1" });
    expect(response.status).toBe(404);
  });

  it("stores 16 unique DIMM serials as 16 separate units", async () => {
    const app = createApp();
    const sess = await request(app).post("/api/sessions").send({ assetTag: "SVR-005", model: "R740" });
    const { id } = sess.body as { id: string };

    for (let index = 0; index < 16; index++) {
      const unitResponse = await request(app)
        .post(`/api/sessions/${id}/units`)
        .send({ partType: "DIMM", serial: `DIMM-${String(index).padStart(3, "0")}` });
      expect(unitResponse.status).toBe(201);
    }

    const sessionResponse = await request(app).get(`/api/sessions/${id}`);
    expect((sessionResponse.body as { units: unknown[] }).units).toHaveLength(16);
  });
});
