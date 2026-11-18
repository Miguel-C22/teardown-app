import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";

// Vercel's env var is set automatically in deployed functions
const IS_VERCEL = !!process.env.VERCEL;

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
}

// ─── In-memory backend (Vercel) ──────────────────────────────────────────────

const memSessions = new Map<string, Session>();
const memUnits = new Map<string, Unit[]>();

// ─── SQLite backend (local dev / production self-hosted) ─────────────────────
// Loaded lazily via createRequire so the native .node binary is never touched on Vercel

const _req = createRequire(import.meta.url);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _db: any = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getDb(): any {
  if (_db) return _db;
  mkdirSync("data", { recursive: true });
  const SqliteDatabase = _req("better-sqlite3");
  _db = new SqliteDatabase("data/teardown.db");
  _db.exec(`
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
  `);
  return _db;
}

// ─── Shared interface ─────────────────────────────────────────────────────────

export function resetDb(): void {
  if (IS_VERCEL) {
    memSessions.clear();
    memUnits.clear();
  } else {
    _db?.close();
    _db = null;
  }
}

export function createSession(assetTag: string, model: string): Session {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  if (IS_VERCEL) {
    const session: Session = { id, assetTag, model, createdAt };
    memSessions.set(id, session);
    memUnits.set(id, []);
    return session;
  }
  getDb().prepare("INSERT INTO sessions VALUES (?, ?, ?, ?)").run(id, assetTag, model, createdAt);
  return { id, assetTag, model, createdAt };
}

export function getSession(id: string): (Session & { units: Unit[] }) | undefined {
  if (IS_VERCEL) {
    const session = memSessions.get(id);
    if (!session) return undefined;
    return { ...session, units: [...(memUnits.get(id) ?? [])] };
  }
  const db = getDb();
  const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as Session | undefined;
  if (!session) return undefined;
  const units = db.prepare("SELECT * FROM units WHERE sessionId = ? ORDER BY scannedAt").all(id) as Unit[];
  return { ...session, units };
}

export function listSessions(): Session[] {
  if (IS_VERCEL) {
    return Array.from(memSessions.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }
  return getDb().prepare("SELECT * FROM sessions ORDER BY createdAt DESC").all() as Session[];
}

export function addUnit(sessionId: string, partType: string, serial: string | null): Unit | null {
  const id = randomUUID();
  const scannedAt = new Date().toISOString();
  const status: Unit["status"] = serial ? "ok" : "review";
  if (IS_VERCEL) {
    if (!memSessions.has(sessionId)) return null;
    const unit: Unit = { id, sessionId, partType, serial, status, scannedAt };
    memUnits.get(sessionId)!.push(unit);
    return unit;
  }
  const db = getDb();
  if (!db.prepare("SELECT id FROM sessions WHERE id = ?").get(sessionId)) return null;
  db.prepare("INSERT INTO units VALUES (?, ?, ?, ?, ?, ?)").run(id, sessionId, partType, serial, status, scannedAt);
  return { id, sessionId, partType, serial, status, scannedAt };
}
