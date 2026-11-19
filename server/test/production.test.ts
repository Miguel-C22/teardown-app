import { rmSync } from "node:fs";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { recordVisionCall, resetDb } from "../src/store.js";

const TEST_DATA_DIRECTORY = "data/test-production";

beforeEach(() => {
  process.env.TEARDOWN_DATA_DIR = TEST_DATA_DIRECTORY;
  resetDb();
});

afterEach(() => {
  resetDb();
  rmSync(TEST_DATA_DIRECTORY, { recursive: true, force: true });
  delete process.env.TEARDOWN_DATA_DIR;
  delete process.env.TEAM_PASSCODE;
  delete process.env.AI_DAILY_BUDGET_USD;
  process.env.VISION_MODE = "mock";
});

describe("sign-in", () => {
  it("is off when no team passcode is set", async () => {
    const app = createApp();
    expect((await request(app).get("/api/me")).body).toEqual({ signInRequired: false, techName: null });
    expect((await request(app).get("/api/sessions")).status).toBe(200);
  });

  it("blocks the API until a tech signs in with the passcode, then records who did the session", async () => {
    process.env.TEAM_PASSCODE = "rack-42";
    const app = createApp();
    expect((await request(app).get("/api/sessions")).status).toBe(401);
    expect((await request(app).get("/api/health")).status).toBe(200);

    const wrong = await request(app).post("/api/login").send({ name: "Alex", passcode: "nope" });
    expect(wrong.status).toBe(401);

    const agent = request.agent(app);
    const login = await agent.post("/api/login").send({ name: "Alex", passcode: "rack-42" });
    expect(login.status).toBe(200);
    expect(login.headers["set-cookie"]?.[0]).toContain("HttpOnly");
    expect((await agent.get("/api/me")).body).toEqual({ signInRequired: true, techName: "Alex" });

    const session = await agent.post("/api/sessions").send({ assetTag: "SVR-AUTH-1" });
    expect(session.status).toBe(201);
    expect(session.body.techName).toBe("Alex");
  });

  it("rejects an edited cookie", async () => {
    process.env.TEAM_PASSCODE = "rack-42";
    const app = createApp();
    const forged = Buffer.from(JSON.stringify({ name: "Mallory", expiresAt: Date.now() + 60_000 })).toString("base64url");
    const response = await request(app).get("/api/sessions").set("Cookie", `teardown_tech=${forged}.not-a-real-signature`);
    expect(response.status).toBe(401);
  });
});

describe("DELETE /api/sessions/:id/units/:unitId", () => {
  it("removes a wrong read and updates the session", async () => {
    const app = createApp();
    const session = (await request(app).post("/api/sessions").send({ assetTag: "SVR-FIX-1" })).body;
    const unit = (await request(app).post(`/api/sessions/${session.id}/units`).send({ partType: "AUTO", serial: "ZC1ABC23", partNumber: "ST4000NM0035" })).body;

    const removed = await request(app).delete(`/api/sessions/${session.id}/units/${unit.id}`);
    expect(removed.status).toBe(200);
    expect(removed.body.session.units).toHaveLength(0);
    expect((await request(app).delete(`/api/sessions/${session.id}/units/${unit.id}`)).status).toBe(404);
  });
});

describe("daily AI budget", () => {
  it("refuses AI calls once today's spend reaches the budget", async () => {
    const app = createApp();
    const session = (await request(app).post("/api/sessions").send({ assetTag: "SVR-BUDGET-1" })).body;
    await recordVisionCall(session.id, { kind: "sweep", mode: "live", inputTokens: 1, outputTokens: 1, costUsd: 0.2, visionMs: 1 });
    process.env.VISION_MODE = "live";
    process.env.AI_DAILY_BUDGET_USD = "0.1";

    const response = await request(app).post(`/api/sessions/${session.id}/vision/sweep`).send({ image: "aGVsbG8=", mediaType: "image/jpeg" });
    expect(response.status).toBe(429);
    expect(response.body.error).toContain("Daily AI budget reached");
    // Barcode scans still work
    const unit = await request(app).post(`/api/sessions/${session.id}/units`).send({ partType: "AUTO", serial: "ZC1ABC23", partNumber: "ST4000NM0035" });
    expect(unit.status).toBe(201);
  });
});
