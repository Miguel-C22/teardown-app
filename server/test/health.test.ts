import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";

describe("GET /api/health", () => {
  it("returns ok with the app name", async () => {
    const response = await request(createApp()).get("/api/health");
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: "ok", app: "teardown-poc" });
  });

  it("returns JSON 404 for unknown API routes", async () => {
    const response = await request(createApp()).get("/api/does-not-exist");
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "not found" });
  });
});
