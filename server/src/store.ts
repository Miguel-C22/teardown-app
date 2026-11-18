import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import type { IdentifiedBy, Recommendation, ReviewReason } from "../../shared/src/recommend.js";
import type { CategoryCount } from "../../shared/src/remaining.js";

// Vercel's env var is set automatically in deployed functions
const IS_VERCEL = !!process.env.VERCEL;
// TEARDOWN_DATA_DIR lets each test file use its own throwaway folder
function dataDirectory(): string {
  return process.env.TEARDOWN_DATA_DIR ?? "data";
}

export function photoDirectory(): string {
  return `${dataDirectory()}/photos`;
}

export interface Session {
  id: string;
  assetTag: string;
  model: string;
  createdAt: string;
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
}

interface UnitRow extends Omit<Unit, "verified" | "reviewReasons"> {
  verified: number;
  reviewReasons: string;
}

// In-memory backend for Vercel, where the filesystem is read-only
const memorySessions = new Map<string, Session>();
const memoryUnits = new Map<string, Unit[]>();
const memorySweeps = new Map<string, StoredSweep[]>();
const memoryUsage = new Map<string, VisionUsage>();

let database: DatabaseSyncType | null = null;

const UNIT_COLUMNS: Array<[string, string]> = [
  ["partNumber", "TEXT"], ["manufacturer", "TEXT"], ["description", "TEXT"],
  ["identifiedBy", "TEXT NOT NULL DEFAULT 'barcode'"], ["evidence", "TEXT"], ["photoPath", "TEXT"],
  ["verified", "INTEGER NOT NULL DEFAULT 0"], ["reviewReasons", "TEXT NOT NULL DEFAULT '[]'"],
  ["priceMin", "REAL"], ["priceMax", "REAL"], ["lookupSource", "TEXT"], ["recommendation", "TEXT NOT NULL DEFAULT 'REVIEW'"],
];

function getDatabase(): DatabaseSyncType {
  if (database) return database;
  mkdirSync(dataDirectory(), { recursive: true });
  // Required lazily: Vite's resolver doesn't know node:sqlite, and Vercel never opens a database
  const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
  database = new DatabaseSync(`${dataDirectory()}/teardown.db`);
  database.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      assetTag TEXT NOT NULL,
      model TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS units (
      id TEXT PRIMARY KEY,
      sessionId TEXT NOT NULL REFERENCES sessions(id),
      partType TEXT NOT NULL,
      serial TEXT,
      status TEXT NOT NULL DEFAULT 'ok',
      scannedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sweeps (
      id TEXT PRIMARY KEY,
      sessionId TEXT NOT NULL REFERENCES sessions(id),
      createdAt TEXT NOT NULL,
      photoPath TEXT,
      countsByCategory TEXT NOT NULL,
      chassisModelGuess TEXT
    );
    CREATE TABLE IF NOT EXISTS vision_calls (
      id TEXT PRIMARY KEY,
      sessionId TEXT NOT NULL REFERENCES sessions(id),
      kind TEXT NOT NULL,
      mode TEXT NOT NULL,
      inputTokens INTEGER NOT NULL,
      outputTokens INTEGER NOT NULL,
      costUsd REAL NOT NULL,
      createdAt TEXT NOT NULL
    );
  `);
  // Older PoC databases predate the identification columns, so add any that are missing
  const existingColumns = new Set((database.prepare("PRAGMA table_info(units)").all() as Array<{ name: string }>).map((column) => column.name));
  for (const [columnName, columnType] of UNIT_COLUMNS) {
    if (!existingColumns.has(columnName)) database.exec(`ALTER TABLE units ADD COLUMN ${columnName} ${columnType}`);
  }
  return database;
}

function rowToUnit(row: UnitRow): Unit {
  return { ...row, verified: row.verified === 1, reviewReasons: JSON.parse(row.reviewReasons ?? "[]") as ReviewReason[] };
}

// Resets everything, including label photos: storage is throwaway by design
export function resetDb(): void {
  if (IS_VERCEL) {
    memorySessions.clear();
    memoryUnits.clear();
    memorySweeps.clear();
    memoryUsage.clear();
    return;
  }
  database?.close();
  database = null;
  rmSync(photoDirectory(), { recursive: true, force: true });
}

export function createSession(assetTag: string, model: string): Session {
  const session: Session = { id: randomUUID(), assetTag, model, createdAt: new Date().toISOString() };
  if (IS_VERCEL) {
    memorySessions.set(session.id, session);
    memoryUnits.set(session.id, []);
    memorySweeps.set(session.id, []);
    return session;
  }
  getDatabase().prepare("INSERT INTO sessions (id, assetTag, model, createdAt) VALUES (?, ?, ?, ?)")
    .run(session.id, session.assetTag, session.model, session.createdAt);
  return session;
}

// The AI's chassis guess fills the model once; a model already set is never overwritten
export function setSessionModelIfEmpty(sessionId: string, model: string): void {
  const trimmed = model.trim();
  if (!trimmed) return;
  if (IS_VERCEL) {
    const session = memorySessions.get(sessionId);
    if (session && !session.model) session.model = trimmed;
    return;
  }
  getDatabase().prepare("UPDATE sessions SET model = ? WHERE id = ? AND model = ''").run(trimmed, sessionId);
}

export function sessionExists(id: string): boolean {
  if (IS_VERCEL) return memorySessions.has(id);
  return getDatabase().prepare("SELECT id FROM sessions WHERE id = ?").get(id) !== undefined;
}

export function getSession(id: string): (Session & { units: Unit[] }) | undefined {
  if (IS_VERCEL) {
    const session = memorySessions.get(id);
    if (!session) return undefined;
    return { ...session, units: [...(memoryUnits.get(id) ?? [])] };
  }
  const db = getDatabase();
  const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as unknown as Session | undefined;
  if (!session) return undefined;
  const unitRows = db.prepare("SELECT * FROM units WHERE sessionId = ? ORDER BY scannedAt").all(id) as unknown as UnitRow[];
  return { ...session, units: unitRows.map(rowToUnit) };
}

export function listSessions(): Session[] {
  if (IS_VERCEL) {
    return Array.from(memorySessions.values()).sort(
      (first, second) => new Date(second.createdAt).getTime() - new Date(first.createdAt).getTime()
    );
  }
  return getDatabase().prepare("SELECT * FROM sessions ORDER BY createdAt DESC").all() as unknown as Session[];
}

export function findUnitBySerial(sessionId: string, serial: string): Unit | null {
  if (IS_VERCEL) return memoryUnits.get(sessionId)?.find((unit) => unit.serial === serial) ?? null;
  const row = getDatabase().prepare("SELECT * FROM units WHERE sessionId = ? AND serial = ?").get(sessionId, serial) as unknown as UnitRow | undefined;
  return row ? rowToUnit(row) : null;
}

// One row per physical unit: a serial already recorded in this session returns the existing unit
export function addUnit(sessionId: string, newUnit: NewUnit): { unit: Unit; duplicate: boolean } | null {
  if (!sessionExists(sessionId)) return null;
  if (newUnit.serial) {
    const existing = findUnitBySerial(sessionId, newUnit.serial);
    if (existing) return { unit: existing, duplicate: true };
  }
  const unit: Unit = {
    ...newUnit,
    id: randomUUID(),
    sessionId,
    scannedAt: new Date().toISOString(),
    status: newUnit.serial ? "ok" : "review",
  };
  if (IS_VERCEL) {
    memoryUnits.get(sessionId)!.push(unit);
    return { unit, duplicate: false };
  }
  getDatabase().prepare(`
    INSERT INTO units (id, sessionId, partType, serial, status, scannedAt, partNumber, manufacturer, description,
      identifiedBy, evidence, photoPath, verified, reviewReasons, priceMin, priceMax, lookupSource, recommendation)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    unit.id, unit.sessionId, unit.partType, unit.serial, unit.status, unit.scannedAt, unit.partNumber, unit.manufacturer,
    unit.description, unit.identifiedBy, unit.evidence, unit.photoPath, unit.verified ? 1 : 0, JSON.stringify(unit.reviewReasons),
    unit.priceMin, unit.priceMax, unit.lookupSource, unit.recommendation,
  );
  return { unit, duplicate: false };
}

export function addSweep(sessionId: string, countsByCategory: CategoryCount[], chassisModelGuess: string | null, photoPath: string | null): StoredSweep {
  const sweep: StoredSweep = { id: randomUUID(), sessionId, createdAt: new Date().toISOString(), photoPath, countsByCategory, chassisModelGuess };
  if (IS_VERCEL) {
    memorySweeps.get(sessionId)?.push(sweep);
    return sweep;
  }
  getDatabase().prepare("INSERT INTO sweeps (id, sessionId, createdAt, photoPath, countsByCategory, chassisModelGuess) VALUES (?, ?, ?, ?, ?, ?)")
    .run(sweep.id, sessionId, sweep.createdAt, photoPath, JSON.stringify(countsByCategory), chassisModelGuess);
  return sweep;
}

export function listSweeps(sessionId: string): StoredSweep[] {
  if (IS_VERCEL) return [...(memorySweeps.get(sessionId) ?? [])];
  const rows = getDatabase().prepare("SELECT * FROM sweeps WHERE sessionId = ? ORDER BY createdAt").all(sessionId) as unknown as Array<Omit<StoredSweep, "countsByCategory"> & { countsByCategory: string }>;
  return rows.map((row) => ({ ...row, countsByCategory: JSON.parse(row.countsByCategory) as CategoryCount[] }));
}

export function recordVisionCall(sessionId: string, kind: "sweep" | "closeup", mode: string, inputTokens: number, outputTokens: number, costUsd: number): void {
  if (IS_VERCEL) {
    const usage = memoryUsage.get(sessionId) ?? { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
    memoryUsage.set(sessionId, { calls: usage.calls + 1, inputTokens: usage.inputTokens + inputTokens, outputTokens: usage.outputTokens + outputTokens, costUsd: usage.costUsd + costUsd });
    return;
  }
  getDatabase().prepare("INSERT INTO vision_calls (id, sessionId, kind, mode, inputTokens, outputTokens, costUsd, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(randomUUID(), sessionId, kind, mode, inputTokens, outputTokens, costUsd, new Date().toISOString());
}

export function getVisionUsage(sessionId: string): VisionUsage {
  if (IS_VERCEL) return memoryUsage.get(sessionId) ?? { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
  const totals = getDatabase().prepare(
    "SELECT COUNT(*) AS calls, COALESCE(SUM(inputTokens), 0) AS inputTokens, COALESCE(SUM(outputTokens), 0) AS outputTokens, COALESCE(SUM(costUsd), 0) AS costUsd FROM vision_calls WHERE sessionId = ?"
  ).get(sessionId) as unknown as VisionUsage;
  return { calls: Number(totals.calls), inputTokens: Number(totals.inputTokens), outputTokens: Number(totals.outputTokens), costUsd: Number(totals.costUsd) };
}
