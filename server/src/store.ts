import { randomInt, randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import type { IdentifiedBy, Recommendation, ReviewReason } from "../../shared/src/recommend.js";
import type { CategoryCount } from "../../shared/src/remaining.js";

// TEARDOWN_DATA_DIR lets each test file use its own throwaway folder
function dataDirectory(): string {
  return process.env.TEARDOWN_DATA_DIR ?? "data";
}

export function photoDirectory(): string {
  return `${dataDirectory()}/photos`;
}

// Postgres (Neon) when DATABASE_URL is set; an empty value counts as unset so tests can force local storage
function databaseUrl(): string | null {
  return process.env.DATABASE_URL?.trim() || null;
}

// Vercel without a database keeps data in memory only, so it can vanish between serverless instances
function usesMemory(): boolean {
  return !!process.env.VERCEL && !databaseUrl();
}

export function storageKind(): "postgres" | "sqlite" | "memory" {
  if (databaseUrl()) return "postgres";
  return usesMemory() ? "memory" : "sqlite";
}

export interface Session {
  id: string;
  assetTag: string;
  model: string;
  createdAt: string;
  techName: string | null;
  pairingCode: string;
}

export interface Unit {
  id: string;
  sessionId: string;
  partType: string;
  serial: string | null;
  status: "ok" | "review";
  scannedAt: string;
  partNumber: string | null;
  manufacturer: string | null;
  description: string | null;
  identifiedBy: IdentifiedBy;
  evidence: string | null;
  photoPath: string | null;
  verified: boolean;
  reviewReasons: ReviewReason[];
  priceMin: number | null;
  priceMax: number | null;
  lookupSource: string | null;
  imageUrl: string | null;
  recommendation: Recommendation;
}

export type NewUnit = Omit<Unit, "id" | "sessionId" | "scannedAt" | "status">;

export interface StoredSweep {
  id: string;
  sessionId: string;
  createdAt: string;
  photoPath: string | null;
  countsByCategory: CategoryCount[];
  chassisModelGuess: string | null;
}

export interface VisionUsage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  visionMs: number;
}

type Row = Record<string, unknown>;

// One small interface over SQLite and Postgres; SQL uses ? placeholders and double-quoted camelCase columns
interface SqlBackend {
  all(sqlText: string, params?: unknown[]): Promise<Row[]>;
  run(sqlText: string, params?: unknown[]): Promise<void>;
  close(): void;
}

const UNIT_COLUMNS: Array<[string, string]> = [
  ["partNumber", "TEXT"], ["manufacturer", "TEXT"], ["description", "TEXT"],
  ["identifiedBy", "TEXT NOT NULL DEFAULT 'barcode'"], ["evidence", "TEXT"], ["photoPath", "TEXT"],
  ["verified", "INTEGER NOT NULL DEFAULT 0"], ["reviewReasons", "TEXT NOT NULL DEFAULT '[]'"],
  ["priceMin", "DOUBLE PRECISION"], ["priceMax", "DOUBLE PRECISION"], ["lookupSource", "TEXT"],
  ["recommendation", "TEXT NOT NULL DEFAULT 'REVIEW'"], ["imageUrl", "TEXT"],
];
const SESSION_COLUMNS: Array<[string, string]> = [["techName", "TEXT"], ["pairingCode", "TEXT NOT NULL DEFAULT ''"]];
const VISION_CALL_COLUMNS: Array<[string, string]> = [["visionMs", "INTEGER NOT NULL DEFAULT 0"]];

const CREATE_TABLES = [
  `CREATE TABLE IF NOT EXISTS sessions ("id" TEXT PRIMARY KEY, "assetTag" TEXT NOT NULL, "model" TEXT NOT NULL, "createdAt" TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS units ("id" TEXT PRIMARY KEY, "sessionId" TEXT NOT NULL REFERENCES sessions("id"), "partType" TEXT NOT NULL,
    "serial" TEXT, "status" TEXT NOT NULL DEFAULT 'ok', "scannedAt" TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS sweeps ("id" TEXT PRIMARY KEY, "sessionId" TEXT NOT NULL REFERENCES sessions("id"), "createdAt" TEXT NOT NULL,
    "photoPath" TEXT, "countsByCategory" TEXT NOT NULL, "chassisModelGuess" TEXT)`,
  `CREATE TABLE IF NOT EXISTS vision_calls ("id" TEXT PRIMARY KEY, "sessionId" TEXT NOT NULL REFERENCES sessions("id"), "kind" TEXT NOT NULL,
    "mode" TEXT NOT NULL, "inputTokens" INTEGER NOT NULL, "outputTokens" INTEGER NOT NULL, "costUsd" DOUBLE PRECISION NOT NULL, "createdAt" TEXT NOT NULL)`,
];
const ADDED_COLUMNS: Array<[string, Array<[string, string]>]> = [["units", UNIT_COLUMNS], ["sessions", SESSION_COLUMNS], ["vision_calls", VISION_CALL_COLUMNS]];

function openSqlite(): SqlBackend {
  mkdirSync(dataDirectory(), { recursive: true });
  // Required lazily: Vite's resolver doesn't know node:sqlite, and Vercel never opens a local database
  const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
  const database: DatabaseSyncType = new DatabaseSync(`${dataDirectory()}/teardown.db`);
  const toSqliteValue = (value: unknown) => (typeof value === "boolean" ? (value ? 1 : 0) : value ?? null) as never;
  return {
    async all(sqlText, params = []) {
      return database.prepare(sqlText).all(...params.map(toSqliteValue)) as Row[];
    },
    async run(sqlText, params = []) {
      database.prepare(sqlText).run(...params.map(toSqliteValue));
    },
    close: () => database.close(),
  };
}

async function openPostgres(connectionString: string): Promise<SqlBackend> {
  // Neon's HTTP driver suits serverless functions: one round trip per query and no pool to keep open
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(connectionString);
  const numbered = (sqlText: string) => {
    let placeholderNumber = 0;
    return sqlText.replace(/\?/g, () => `$${++placeholderNumber}`);
  };
  return {
    async all(sqlText, params = []) {
      return (await sql.query(numbered(sqlText), params)) as Row[];
    },
    async run(sqlText, params = []) {
      await sql.query(numbered(sqlText), params);
    },
    close: () => undefined,
  };
}

async function addMissingColumns(backend: SqlBackend, kind: "postgres" | "sqlite"): Promise<void> {
  for (const [tableName, columns] of ADDED_COLUMNS) {
    if (kind === "postgres") {
      for (const [columnName, columnType] of columns) await backend.run(`ALTER TABLE ${tableName} ADD COLUMN IF NOT EXISTS "${columnName}" ${columnType}`);
      continue;
    }
    const existing = new Set((await backend.all(`PRAGMA table_info(${tableName})`)).map((column) => String(column.name)));
    for (const [columnName, columnType] of columns) {
      if (!existing.has(columnName)) await backend.run(`ALTER TABLE ${tableName} ADD COLUMN "${columnName}" ${columnType}`);
    }
  }
}

let backendPromise: Promise<SqlBackend> | null = null;
// Kept so resetDb can close the SQLite file synchronously before tests delete its folder
let openBackend: SqlBackend | null = null;

function getBackend(): Promise<SqlBackend> {
  backendPromise ??= (async () => {
    const connectionString = databaseUrl();
    const backend = connectionString ? await openPostgres(connectionString) : openSqlite();
    openBackend = backend;
    for (const statement of CREATE_TABLES) await backend.run(statement);
    await addMissingColumns(backend, connectionString ? "postgres" : "sqlite");
    return backend;
  })();
  // A failed connection is retried on the next request instead of being cached forever
  backendPromise.catch(() => { backendPromise = null; });
  return backendPromise;
}

async function all(sqlText: string, params: unknown[] = []): Promise<Row[]> {
  return (await getBackend()).all(sqlText, params);
}

async function first(sqlText: string, params: unknown[] = []): Promise<Row | undefined> {
  return (await all(sqlText, params))[0];
}

async function run(sqlText: string, params: unknown[] = []): Promise<void> {
  await (await getBackend()).run(sqlText, params);
}

// In-memory backend for Vercel when no DATABASE_URL is set
const memorySessions = new Map<string, Session>();
const memoryUnits = new Map<string, Unit[]>();
const memorySweeps = new Map<string, StoredSweep[]>();
const memoryVisionCalls: Array<{ sessionId: string; inputTokens: number; outputTokens: number; costUsd: number; visionMs: number; createdAt: string }> = [];

// A part-number-only unit this recent gets the serial when the rest of its label is read a moment later
const FILL_IN_WINDOW_MS = 60_000;

const nullableNumber = (value: unknown) => (value === null || value === undefined ? null : Number(value));

function rowToSession(row: Row): Session {
  return {
    id: String(row.id), assetTag: String(row.assetTag), model: String(row.model ?? ""), createdAt: String(row.createdAt),
    techName: (row.techName as string | null) ?? null, pairingCode: String(row.pairingCode ?? ""),
  };
}

function rowToUnit(row: Row): Unit {
  return {
    ...(row as unknown as Unit),
    verified: Number(row.verified) === 1,
    reviewReasons: JSON.parse(String(row.reviewReasons ?? "[]")) as ReviewReason[],
    priceMin: nullableNumber(row.priceMin),
    priceMax: nullableNumber(row.priceMax),
  };
}

// Resets local and memory storage, including label photos; a Postgres database is never wiped from here
export function resetDb(): void {
  memorySessions.clear();
  memoryUnits.clear();
  memorySweeps.clear();
  memoryVisionCalls.length = 0;
  if (storageKind() !== "sqlite") return;
  openBackend?.close();
  openBackend = null;
  backendPromise = null;
  rmSync(photoDirectory(), { recursive: true, force: true });
}

// Six digits the bench PC script types in to send its hardware report to this session
function newPairingCode(): string {
  return String(randomInt(100_000, 1_000_000));
}

export async function createSession(assetTag: string, model: string, techName: string | null = null): Promise<Session> {
  const session: Session = { id: randomUUID(), assetTag, model, createdAt: new Date().toISOString(), techName, pairingCode: newPairingCode() };
  if (usesMemory()) {
    memorySessions.set(session.id, session);
    memoryUnits.set(session.id, []);
    memorySweeps.set(session.id, []);
    return session;
  }
  await run(`INSERT INTO sessions ("id", "assetTag", "model", "createdAt", "techName", "pairingCode") VALUES (?, ?, ?, ?, ?, ?)`,
    [session.id, session.assetTag, session.model, session.createdAt, session.techName, session.pairingCode]);
  return session;
}

// The AI's chassis guess fills the model once; a model already set is never overwritten
export async function setSessionModelIfEmpty(sessionId: string, model: string): Promise<void> {
  const trimmed = model.trim();
  if (!trimmed) return;
  if (usesMemory()) {
    const session = memorySessions.get(sessionId);
    if (session && !session.model) session.model = trimmed;
    return;
  }
  await run(`UPDATE sessions SET "model" = ? WHERE "id" = ? AND "model" = ''`, [trimmed, sessionId]);
}

export async function sessionExists(id: string): Promise<boolean> {
  if (usesMemory()) return memorySessions.has(id);
  return (await first(`SELECT "id" FROM sessions WHERE "id" = ?`, [id])) !== undefined;
}

export async function findSessionByPairingCode(pairingCode: string): Promise<Session | null> {
  if (usesMemory()) return [...memorySessions.values()].find((session) => session.pairingCode === pairingCode) ?? null;
  const row = await first(`SELECT * FROM sessions WHERE "pairingCode" = ? ORDER BY "createdAt" DESC`, [pairingCode]);
  return row ? rowToSession(row) : null;
}

export async function getSession(id: string): Promise<(Session & { units: Unit[] }) | undefined> {
  if (usesMemory()) {
    const session = memorySessions.get(id);
    if (!session) return undefined;
    return { ...session, units: [...(memoryUnits.get(id) ?? [])] };
  }
  const sessionRow = await first(`SELECT * FROM sessions WHERE "id" = ?`, [id]);
  if (!sessionRow) return undefined;
  const unitRows = await all(`SELECT * FROM units WHERE "sessionId" = ? ORDER BY "scannedAt"`, [id]);
  return { ...rowToSession(sessionRow), units: unitRows.map(rowToUnit) };
}

export async function listSessions(): Promise<Session[]> {
  if (usesMemory()) {
    return Array.from(memorySessions.values()).sort((firstSession, secondSession) => secondSession.createdAt.localeCompare(firstSession.createdAt));
  }
  return (await all(`SELECT * FROM sessions ORDER BY "createdAt" DESC`)).map(rowToSession);
}

export async function findUnitBySerial(sessionId: string, serial: string): Promise<Unit | null> {
  if (usesMemory()) return memoryUnits.get(sessionId)?.find((unit) => unit.serial === serial) ?? null;
  const row = await first(`SELECT * FROM units WHERE "sessionId" = ? AND "serial" = ?`, [sessionId, serial]);
  return row ? rowToUnit(row) : null;
}

async function findRecentUnitWithoutSerial(sessionId: string, partNumber: string): Promise<Unit | null> {
  const since = new Date(Date.now() - FILL_IN_WINDOW_MS).toISOString();
  if (usesMemory()) {
    const candidates = (memoryUnits.get(sessionId) ?? []).filter((unit) => unit.partNumber === partNumber && !unit.serial && unit.scannedAt >= since);
    return candidates.at(-1) ?? null;
  }
  const row = await first(
    `SELECT * FROM units WHERE "sessionId" = ? AND "partNumber" = ? AND "serial" IS NULL AND "scannedAt" >= ? ORDER BY "scannedAt" DESC`,
    [sessionId, partNumber, since],
  );
  return row ? rowToUnit(row) : null;
}

// Writes every field of a unit that already exists, keeping its id
export async function updateUnit(unit: Unit): Promise<Unit> {
  if (usesMemory()) {
    const units = memoryUnits.get(unit.sessionId)!;
    units[units.findIndex((stored) => stored.id === unit.id)] = unit;
    return unit;
  }
  await run(`
    UPDATE units SET "partType" = ?, "serial" = ?, "status" = ?, "partNumber" = ?, "manufacturer" = ?, "description" = ?, "identifiedBy" = ?,
      "evidence" = ?, "photoPath" = ?, "verified" = ?, "reviewReasons" = ?, "priceMin" = ?, "priceMax" = ?, "lookupSource" = ?, "imageUrl" = ?,
      "recommendation" = ?
    WHERE "id" = ?
  `, [
    unit.partType, unit.serial, unit.status, unit.partNumber, unit.manufacturer, unit.description, unit.identifiedBy, unit.evidence,
    unit.photoPath, unit.verified ? 1 : 0, JSON.stringify(unit.reviewReasons), unit.priceMin, unit.priceMax, unit.lookupSource, unit.imageUrl,
    unit.recommendation, unit.id,
  ]);
  return unit;
}

// Removes a wrong read; returns false when the unit isn't in that session
export async function deleteUnit(sessionId: string, unitId: string): Promise<boolean> {
  if (usesMemory()) {
    const units = memoryUnits.get(sessionId) ?? [];
    const index = units.findIndex((unit) => unit.id === unitId);
    if (index === -1) return false;
    units.splice(index, 1);
    return true;
  }
  const existing = await first(`SELECT "id" FROM units WHERE "id" = ? AND "sessionId" = ?`, [unitId, sessionId]);
  if (!existing) return false;
  await run(`DELETE FROM units WHERE "id" = ? AND "sessionId" = ?`, [unitId, sessionId]);
  return true;
}

// Replaces what we know about an existing unit, keeping its id, time and any photo already taken
function fillInUnit(existing: Unit, newUnit: NewUnit): Promise<Unit> {
  return updateUnit({
    ...newUnit,
    id: existing.id,
    sessionId: existing.sessionId,
    scannedAt: existing.scannedAt,
    photoPath: existing.photoPath ?? newUnit.photoPath,
    imageUrl: newUnit.imageUrl ?? existing.imageUrl,
    status: newUnit.serial ? "ok" : "review",
  });
}

// One row per physical unit: a known serial returns the existing unit, and a label read in two goes fills in what was missing
export async function addUnit(sessionId: string, newUnit: NewUnit): Promise<{ unit: Unit; duplicate: boolean; filledIn: boolean } | null> {
  if (!(await sessionExists(sessionId))) return null;
  if (newUnit.serial) {
    const existing = await findUnitBySerial(sessionId, newUnit.serial);
    if (existing && !existing.partNumber && newUnit.partNumber) return { unit: await fillInUnit(existing, newUnit), duplicate: false, filledIn: true };
    if (existing) return { unit: existing, duplicate: true, filledIn: false };
    const waitingForSerial = newUnit.partNumber ? await findRecentUnitWithoutSerial(sessionId, newUnit.partNumber) : null;
    if (waitingForSerial) return { unit: await fillInUnit(waitingForSerial, newUnit), duplicate: false, filledIn: true };
  }
  const unit: Unit = {
    ...newUnit,
    id: randomUUID(),
    sessionId,
    scannedAt: new Date().toISOString(),
    status: newUnit.serial ? "ok" : "review",
  };
  if (usesMemory()) {
    memoryUnits.get(sessionId)!.push(unit);
    return { unit, duplicate: false, filledIn: false };
  }
  await run(`
    INSERT INTO units ("id", "sessionId", "partType", "serial", "status", "scannedAt", "partNumber", "manufacturer", "description",
      "identifiedBy", "evidence", "photoPath", "verified", "reviewReasons", "priceMin", "priceMax", "lookupSource", "imageUrl", "recommendation")
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    unit.id, unit.sessionId, unit.partType, unit.serial, unit.status, unit.scannedAt, unit.partNumber, unit.manufacturer,
    unit.description, unit.identifiedBy, unit.evidence, unit.photoPath, unit.verified ? 1 : 0, JSON.stringify(unit.reviewReasons),
    unit.priceMin, unit.priceMax, unit.lookupSource, unit.imageUrl, unit.recommendation,
  ]);
  return { unit, duplicate: false, filledIn: false };
}

export async function addSweep(sessionId: string, countsByCategory: CategoryCount[], chassisModelGuess: string | null, photoPath: string | null): Promise<StoredSweep> {
  const sweep: StoredSweep = { id: randomUUID(), sessionId, createdAt: new Date().toISOString(), photoPath, countsByCategory, chassisModelGuess };
  if (usesMemory()) {
    memorySweeps.get(sessionId)?.push(sweep);
    return sweep;
  }
  await run(`INSERT INTO sweeps ("id", "sessionId", "createdAt", "photoPath", "countsByCategory", "chassisModelGuess") VALUES (?, ?, ?, ?, ?, ?)`,
    [sweep.id, sessionId, sweep.createdAt, photoPath, JSON.stringify(countsByCategory), chassisModelGuess]);
  return sweep;
}

export async function listSweeps(sessionId: string): Promise<StoredSweep[]> {
  if (usesMemory()) return [...(memorySweeps.get(sessionId) ?? [])];
  const rows = await all(`SELECT * FROM sweeps WHERE "sessionId" = ? ORDER BY "createdAt"`, [sessionId]);
  return rows.map((row) => ({
    id: String(row.id), sessionId: String(row.sessionId), createdAt: String(row.createdAt), photoPath: (row.photoPath as string | null) ?? null,
    countsByCategory: JSON.parse(String(row.countsByCategory)) as CategoryCount[], chassisModelGuess: (row.chassisModelGuess as string | null) ?? null,
  }));
}

export interface VisionCallRecord {
  kind: "sweep" | "closeup";
  mode: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  visionMs: number;
}

export async function recordVisionCall(sessionId: string, call: VisionCallRecord): Promise<void> {
  const createdAt = new Date().toISOString();
  if (usesMemory()) {
    memoryVisionCalls.push({ sessionId, inputTokens: call.inputTokens, outputTokens: call.outputTokens, costUsd: call.costUsd, visionMs: call.visionMs, createdAt });
    return;
  }
  await run(`INSERT INTO vision_calls ("id", "sessionId", "kind", "mode", "inputTokens", "outputTokens", "costUsd", "createdAt", "visionMs") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [randomUUID(), sessionId, call.kind, call.mode, call.inputTokens, call.outputTokens, call.costUsd, createdAt, Math.round(call.visionMs)]);
}

const EMPTY_USAGE: VisionUsage = { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, visionMs: 0 };

export async function getVisionUsage(sessionId: string): Promise<VisionUsage> {
  if (usesMemory()) {
    return memoryVisionCalls.filter((call) => call.sessionId === sessionId).reduce((totals, call) => ({
      calls: totals.calls + 1, inputTokens: totals.inputTokens + call.inputTokens, outputTokens: totals.outputTokens + call.outputTokens,
      costUsd: totals.costUsd + call.costUsd, visionMs: totals.visionMs + call.visionMs,
    }), EMPTY_USAGE);
  }
  const totals = await first(`SELECT COUNT(*) AS "calls", COALESCE(SUM("inputTokens"), 0) AS "inputTokens", COALESCE(SUM("outputTokens"), 0) AS "outputTokens",
    COALESCE(SUM("costUsd"), 0) AS "costUsd", COALESCE(SUM("visionMs"), 0) AS "visionMs" FROM vision_calls WHERE "sessionId" = ?`, [sessionId]);
  return {
    calls: Number(totals?.calls ?? 0), inputTokens: Number(totals?.inputTokens ?? 0), outputTokens: Number(totals?.outputTokens ?? 0),
    costUsd: Number(totals?.costUsd ?? 0), visionMs: Number(totals?.visionMs ?? 0),
  };
}

// Total AI spend across every session since a point in time, for the daily budget
export async function visionSpendSince(sinceIso: string): Promise<number> {
  if (usesMemory()) return memoryVisionCalls.filter((call) => call.createdAt >= sinceIso).reduce((total, call) => total + call.costUsd, 0);
  const totals = await first(`SELECT COALESCE(SUM("costUsd"), 0) AS "costUsd" FROM vision_calls WHERE "createdAt" >= ?`, [sinceIso]);
  return Number(totals?.costUsd ?? 0);
}
