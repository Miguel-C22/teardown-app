import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addSweep, addUnit, createSession, deleteUnit, findSessionByPairingCode, getSession, getVisionUsage, recordVisionCall, resetDb, setSessionModelIfEmpty,
  storageKind, visionSpendSince, type NewUnit,
} from "../src/store.js";

const TEST_DATA_DIRECTORY = "data/test-store-contract";
// Set TEST_DATABASE_URL to a throwaway Neon branch to run the same checks against Postgres
const postgresUrl = process.env.TEST_DATABASE_URL?.trim() ?? "";

const DRIVE: NewUnit = {
  partType: "HDD", serial: null, partNumber: "ST2000DM001", manufacturer: "Seagate", description: null, identifiedBy: "barcode",
  evidence: "ST2000DM001", photoPath: null, verified: false, reviewReasons: ["no-serial"], priceMin: 10.5, priceMax: 25,
  lookupSource: "catalog", imageUrl: null, recommendation: "REVIEW",
};

beforeAll(() => {
  process.env.TEARDOWN_DATA_DIR = TEST_DATA_DIRECTORY;
  process.env.DATABASE_URL = postgresUrl;
  resetDb();
});

afterAll(() => {
  resetDb();
  rmSync(TEST_DATA_DIRECTORY, { recursive: true, force: true });
  delete process.env.TEARDOWN_DATA_DIR;
  process.env.DATABASE_URL = "";
});

describe(`store contract (${postgresUrl ? "postgres" : "sqlite"})`, () => {
  it("uses the expected backend", () => {
    expect(storageKind()).toBe(postgresUrl ? "postgres" : "sqlite");
  });

  it("round-trips a session, its units, sweeps and vision usage", async () => {
    const startedAt = new Date().toISOString();
    const session = await createSession(`CONTRACT-${Date.now()}`, "", "Alex");
    expect(session.pairingCode).toMatch(/^\d{6}$/);
    await setSessionModelIfEmpty(session.id, "PowerEdge R740");
    await setSessionModelIfEmpty(session.id, "should not overwrite");

    const first = await addUnit(session.id, DRIVE);
    const filled = await addUnit(session.id, { ...DRIVE, serial: "Z1E41HH0", reviewReasons: [], verified: true });
    expect(filled?.filledIn).toBe(true);
    expect(filled?.unit.id).toBe(first?.unit.id);
    const duplicate = await addUnit(session.id, { ...DRIVE, serial: "Z1E41HH0" });
    expect(duplicate?.duplicate).toBe(true);

    await addSweep(session.id, [{ category: "HDD", count: 4 }], "PowerEdge R740", null);
    await recordVisionCall(session.id, { kind: "sweep", mode: "mock", inputTokens: 100, outputTokens: 20, costUsd: 0.25, visionMs: 1200 });

    const stored = await getSession(session.id);
    expect(stored?.model).toBe("PowerEdge R740");
    expect(stored?.techName).toBe("Alex");
    expect(stored?.units).toHaveLength(1);
    expect(stored?.units[0]).toMatchObject({ serial: "Z1E41HH0", verified: true, priceMin: 10.5, priceMax: 25, reviewReasons: [] });
    expect((await findSessionByPairingCode(session.pairingCode))?.id).toBe(session.id);
    expect(await getVisionUsage(session.id)).toMatchObject({ calls: 1, inputTokens: 100, costUsd: 0.25, visionMs: 1200 });
    expect(await visionSpendSince(startedAt)).toBeGreaterThanOrEqual(0.25);

    // Removing a wrong read, and refusing a unit from another session
    expect(await deleteUnit("another-session", first!.unit.id)).toBe(false);
    expect(await deleteUnit(session.id, first!.unit.id)).toBe(true);
    expect((await getSession(session.id))?.units).toHaveLength(0);
  });
});
