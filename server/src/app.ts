import path from "node:path";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { buildCsv } from "../../shared/src/csvExport.js";
import { IDENTIFIED_BY_VALUES, type IdentifiedBy } from "../../shared/src/recommend.js";
import { expectedCountsFromSweeps, remainingByCategory } from "../../shared/src/remaining.js";
import { isNumberReadFromImage, readPartNumber, readSerial, type PriceRange } from "../../shared/src/visionSchema.js";
import { buildUnit, savePhoto } from "./identify.js";
import { lookupByDescription, lookupPartNumber } from "./lookup.js";
import {
  addSweep, addUnit, createSession, deleteUnit, findSessionByPairingCode, findUnitBySerial, getSession, getVisionUsage, listSessions, listSweeps, photoDirectory,
  recordVisionCall, sessionExists, setSessionModelIfEmpty, storageKind, updateUnit, visionSpendSince,
} from "./store.js";
import { mergeHardwareIntoUnit, parseHardwareReport } from "./hardwareReport.js";
import { clearSignInCookie, passcodeMatches, requireSignIn, setSignInCookie, signInRequired, signedInTech } from "./auth.js";
import { VisionError, analyzeCloseup, analyzeSweep, visionMode, type VisionRequest } from "./vision.js";

const IMAGE_MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
// About 7 MB of image once decoded; phones send a downscaled JPEG well under this
const MAX_IMAGE_BASE64_LENGTH = 9_500_000;

interface ImageBody {
  image?: string;
  mediaType?: string;
  fixture?: string;
  categoryHint?: string;
}

function readImageBody(body: ImageBody, response: Response): Omit<VisionRequest, "serverModel"> | null {
  const imageBase64 = typeof body.image === "string" ? body.image.replace(/^data:image\/\w+;base64,/, "") : "";
  const mediaType = (IMAGE_MEDIA_TYPES as readonly string[]).includes(body.mediaType ?? "") ? body.mediaType as VisionRequest["mediaType"] : "image/jpeg";
  if (!imageBase64 && visionMode() === "live") {
    response.status(400).json({ error: "image is required" });
    return null;
  }
  if (imageBase64.length > MAX_IMAGE_BASE64_LENGTH) {
    response.status(413).json({ error: "image is too large" });
    return null;
  }
  // Fixtures exist only so automated tests can choose a mock reading
  const fixture = visionMode() === "mock" && typeof body.fixture === "string" ? body.fixture : undefined;
  return { imageBase64, mediaType, fixture };
}

interface AppearanceInfo {
  searchQuery?: string | null;
  estimatedPriceUsd?: PriceRange | null;
}

function isPriceRange(value: unknown): value is PriceRange {
  const candidate = value as PriceRange | null;
  return typeof candidate?.low === "number" && typeof candidate?.high === "number";
}

// A read part number is priced first; a part known only by appearance falls back to its description
async function priceLookup(partNumber: string | null, category: string, appearance: AppearanceInfo) {
  const byPartNumber = partNumber ? await lookupPartNumber(partNumber) : null;
  if (byPartNumber) return byPartNumber;
  return lookupByDescription({
    searchQuery: typeof appearance.searchQuery === "string" ? appearance.searchQuery : null,
    category,
    estimatedPriceUsd: isPriceRange(appearance.estimatedPriceUsd) ? appearance.estimatedPriceUsd : null,
  });
}

const DEFAULT_AI_DAILY_BUDGET_USD = 5;

function aiDailyBudgetUsd(): number {
  const configured = Number(process.env.AI_DAILY_BUDGET_USD);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_AI_DAILY_BUDGET_USD;
}

// Stops AI calls once today's spend (UTC) reaches the budget; barcodes, sticker reading and hardware reports keep working
async function aiBudgetExceeded(response: Response): Promise<boolean> {
  if (visionMode() === "mock") return false;
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const spentToday = await visionSpendSince(startOfDay.toISOString());
  if (spentToday < aiDailyBudgetUsd()) return false;
  response.status(429).json({ error: `Daily AI budget reached ($${aiDailyBudgetUsd().toFixed(2)}). Barcodes and Read sticker still work.` });
  return true;
}

// One structured line per AI call, readable in Vercel's logs
function logVisionCall(kind: "sweep" | "closeup", sessionId: string, visionMs: number, costUsd: number, mode: string): void {
  console.log(JSON.stringify({ event: "vision_call", kind, sessionId, mode, visionMs, costUsd: Number(costUsd.toFixed(5)) }));
}

function sendVisionError(visionError: unknown, response: Response): void {
  if (visionError instanceof VisionError) {
    response.status(visionError.statusCode).json({ error: visionError.message });
    return;
  }
  console.error(JSON.stringify({ event: "vision_error", message: visionError instanceof Error ? visionError.message : String(visionError) }));
  response.status(500).json({ error: "vision request failed" });
}

async function sessionSummary(sessionId: string) {
  const session = await getSession(sessionId);
  if (!session) return undefined;
  const sweeps = await listSweeps(sessionId);
  return {
    ...session,
    remaining: remainingByCategory(expectedCountsFromSweeps(sweeps), session.units),
    sweepCount: sweeps.length,
    visionUsage: await getVisionUsage(sessionId),
  };
}

type RouteHandler = (request: Request, response: Response) => Promise<void> | void;

// Express 4 doesn't catch rejected promises, so a failed database call would otherwise hang the request
function asyncRoute(handler: RouteHandler) {
  return (request: Request, response: Response, next: NextFunction) => {
    Promise.resolve(handler(request, response)).catch(next);
  };
}

export function createApp(): Express {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use(requireSignIn);

  app.get("/api/health", (_request, response) => {
    response.json({ status: "ok", app: "teardown-poc", visionMode: visionMode(), storage: storageKind(), time: new Date().toISOString() });
  });

  app.get("/api/me", (request, response) => {
    response.json({ signInRequired: signInRequired(), techName: signedInTech(request) });
  });

  app.post("/api/login", (request, response) => {
    const { name, passcode } = request.body as { name?: string; passcode?: string };
    const techName = name?.trim().slice(0, 60) ?? "";
    if (!signInRequired()) {
      response.json({ techName: null });
      return;
    }
    if (!techName || !passcodeMatches(passcode ?? "")) {
      response.status(401).json({ error: "Name and the team passcode are required" });
      return;
    }
    setSignInCookie(response, techName);
    response.json({ techName });
  });

  app.post("/api/logout", (_request, response) => {
    clearSignInCookie(response);
    response.json({ techName: null });
  });

  app.post("/api/sessions", asyncRoute(async (request, response) => {
    const { assetTag, model } = request.body as { assetTag?: string; model?: string };
    if (!assetTag?.trim()) {
      response.status(400).json({ error: "assetTag is required" });
      return;
    }
    // The model is optional: the first sweep fills it in from the chassis photo
    response.status(201).json(await createSession(assetTag.trim(), model?.trim() ?? "", signedInTech(request)));
  }));

  app.get("/api/sessions", asyncRoute(async (_request, response) => {
    response.json(await listSessions());
  }));

  app.get("/api/sessions/:id", asyncRoute(async (request, response) => {
    const summary = await sessionSummary(request.params.id);
    if (!summary) {
      response.status(404).json({ error: "session not found" });
      return;
    }
    response.json(summary);
  }));

  app.post("/api/sessions/:id/units", asyncRoute(async (request, response) => {
    const body = request.body as AppearanceInfo & {
      partType?: string; serial?: string | null; partNumber?: string | null; manufacturer?: string | null;
      description?: string | null; identifiedBy?: string; evidence?: string | null; partNumberRead?: boolean;
    };
    if (!body.partType) {
      response.status(400).json({ error: "partType is required" });
      return;
    }
    if (!(await sessionExists(request.params.id))) {
      response.status(404).json({ error: "session not found" });
      return;
    }
    const identifiedBy = IDENTIFIED_BY_VALUES.includes(body.identifiedBy as IdentifiedBy) ? body.identifiedBy as IdentifiedBy : "barcode";
    // Only parts added by look carry the AI's description; barcode scans keep the part-number-only lookup
    const knownLookup = identifiedBy === "visual" || body.searchQuery || body.estimatedPriceUsd
      ? await priceLookup(body.partNumber?.trim() || null, body.partType, body)
      : undefined;
    const { unit: newUnit } = await buildUnit({
      partType: body.partType,
      serial: body.serial ?? null,
      partNumber: body.partNumber ?? null,
      partNumberRead: body.partNumberRead ?? identifiedBy !== "visual",
      manufacturer: body.manufacturer ?? null,
      description: body.description ?? null,
      identifiedBy,
      evidence: body.evidence ?? null,
      photoPath: null,
    }, knownLookup);
    const added = await addUnit(request.params.id, newUnit);
    if (!added) {
      response.status(404).json({ error: "session not found" });
      return;
    }
    response.status(added.duplicate || added.filledIn ? 200 : 201).json({ ...added.unit, duplicate: added.duplicate, filledIn: added.filledIn });
  }));

  // Fix a wrong read: the part leaves the session, the checklist and the export
  app.delete("/api/sessions/:id/units/:unitId", asyncRoute(async (request, response) => {
    if (!(await deleteUnit(request.params.id, request.params.unitId))) {
      response.status(404).json({ error: "unit not found" });
      return;
    }
    response.json({ deleted: true, session: await sessionSummary(request.params.id) });
  }));

  app.post("/api/sessions/:id/vision/sweep", asyncRoute(async (request, response) => {
    const session = await getSession(request.params.id);
    if (!session) {
      response.status(404).json({ error: "session not found" });
      return;
    }
    const image = readImageBody(request.body as ImageBody, response);
    if (!image || await aiBudgetExceeded(response)) return;
    try {
      const visionStartedAt = performance.now();
      const vision = await analyzeSweep({ ...image, serverModel: session.model || null });
      const visionMs = Math.round(performance.now() - visionStartedAt);
      await recordVisionCall(session.id, { kind: "sweep", mode: vision.mode, ...vision.usage, visionMs });
      logVisionCall("sweep", session.id, visionMs, vision.usage.costUsd, vision.mode);
      const photoPath = image.imageBase64 ? savePhoto(image.imageBase64, image.mediaType) : null;
      const sweep = await addSweep(session.id, vision.result.countsByCategory, vision.result.chassisModelGuess, photoPath);
      if (!session.model && vision.result.chassisModelGuess) await setSessionModelIfEmpty(session.id, vision.result.chassisModelGuess);

      // Prices are looked up in parallel; units are then added one by one so two parts with the same serial can't both be added
      const lookupStartedAt = performance.now();
      const lookups = await Promise.all(vision.result.parts.map((part) => priceLookup(readPartNumber(part), part.category, part)));
      const lookupMs = Math.round(performance.now() - lookupStartedAt);
      const parts = [];
      for (const [index, part] of vision.result.parts.entries()) {
        const partNumber = readPartNumber(part);
        const serial = readSerial(part);
        const lookup = lookups[index];
        let unitId: string | null = null;
        let duplicate = false;
        // Parts with both numbers legible are recorded straight away; the rest wait for a tap or a close-up
        if (partNumber && serial) {
          const { unit: newUnit } = await buildUnit({
            partType: part.category, serial, partNumber, partNumberRead: true, manufacturer: part.manufacturer,
            description: part.familyGuess, identifiedBy: "label-read",
            evidence: part.printedText.filter((printed) => printed.readFromImage).map((printed) => printed.text).join(" | "),
            photoPath,
          }, lookup);
          const added = await addUnit(session.id, newUnit);
          unitId = added?.unit.id ?? null;
          duplicate = added?.duplicate ?? false;
        }
        parts.push({ ...part, index, partNumber, serial, lookup, unitId, duplicate });
      }

      response.json({
        sweepId: sweep.id, mode: vision.mode, usage: vision.usage, timing: { visionMs, lookupMs },
        chassisModelGuess: vision.result.chassisModelGuess, parts, session: await sessionSummary(session.id),
      });
    } catch (visionError) {
      sendVisionError(visionError, response);
    }
  }));

  app.post("/api/sessions/:id/vision/closeup", asyncRoute(async (request, response) => {
    const session = await getSession(request.params.id);
    if (!session) {
      response.status(404).json({ error: "session not found" });
      return;
    }
    const body = request.body as ImageBody;
    const image = readImageBody(body, response);
    if (!image || await aiBudgetExceeded(response)) return;
    try {
      const visionStartedAt = performance.now();
      const vision = await analyzeCloseup({ ...image, serverModel: session.model || null, categoryHint: body.categoryHint ?? null });
      const visionMs = Math.round(performance.now() - visionStartedAt);
      await recordVisionCall(session.id, { kind: "closeup", mode: vision.mode, ...vision.usage, visionMs });
      logVisionCall("closeup", session.id, visionMs, vision.usage.costUsd, vision.mode);
      const reading = vision.result;
      const partNumberRead = isNumberReadFromImage(reading.partNumber, reading.printedText);
      const serialRead = isNumberReadFromImage(reading.serial, reading.printedText);
      const legibleText = reading.printedText.filter((printed) => printed.readFromImage).map((printed) => printed.text);
      const unconfirmed = [
        !partNumberRead && reading.partNumber ? `unconfirmed part number ${reading.partNumber}` : null,
        !serialRead && reading.serial ? `unconfirmed serial ${reading.serial}` : null,
      ].filter((note): note is string => note !== null);
      const photoPath = image.imageBase64 ? savePhoto(image.imageBase64, image.mediaType) : null;
      const knownLookup = await priceLookup(partNumberRead ? reading.partNumber : null, reading.category, reading);

      const { unit: newUnit, lookup } = await buildUnit({
        partType: reading.category,
        serial: serialRead ? reading.serial : null,
        partNumber: partNumberRead ? reading.partNumber : null,
        partNumberRead,
        manufacturer: reading.manufacturer,
        description: reading.model ?? reading.familyGuess,
        identifiedBy: partNumberRead ? "label-read" : "visual",
        evidence: [...legibleText, ...unconfirmed].join(" | ") || reading.familyGuess,
        photoPath,
      }, knownLookup);
      const added = await addUnit(session.id, newUnit);
      if (!added) {
        response.status(404).json({ error: "session not found" });
        return;
      }
      response.json({
        unit: added.unit, duplicate: added.duplicate, lookup, reading, mode: vision.mode, usage: vision.usage, timing: { visionMs },
        session: await sessionSummary(session.id),
      });
    } catch (visionError) {
      sendVisionError(visionError, response);
    }
  }));

  // Tier 4: the bench PC script posts what it read from the hardware; parts are matched to the session by serial
  app.post("/api/hardware-reports", express.text({ type: "text/plain", limit: "5mb" }), asyncRoute(async (request, response) => {
    const reportText = typeof request.body === "string" ? request.body : "";
    const report = parseHardwareReport(reportText);
    const pairingCode = report.pairingCode ?? (typeof request.query.code === "string" ? request.query.code.trim() : null);
    if (!pairingCode || !/^\d{6}$/.test(pairingCode)) {
      response.status(400).json({ error: "a 6-digit pairing code is required (shown on the bench screen)" });
      return;
    }
    const session = await findSessionByPairingCode(pairingCode);
    if (!session) {
      response.status(404).json({ error: `no session with pairing code ${pairingCode}` });
      return;
    }
    let matched = 0;
    let added = 0;
    const recorded = [];
    for (const part of report.parts) {
      const { unit: fromHardware } = await buildUnit({
        partType: part.category, serial: part.serial, partNumber: part.partNumber, partNumberRead: part.partNumber !== null,
        manufacturer: part.manufacturer, description: part.description, identifiedBy: "hardware", evidence: part.evidence, photoPath: null,
      });
      const existing = await findUnitBySerial(session.id, part.serial);
      if (existing) {
        recorded.push(await updateUnit(mergeHardwareIntoUnit(existing, fromHardware)));
        matched++;
      } else {
        const result = await addUnit(session.id, fromHardware);
        if (result) recorded.push(result.unit);
        added++;
      }
    }
    console.log(JSON.stringify({ event: "hardware_report", sessionId: session.id, matched, added, sightings: report.sightings.length }));
    response.json({
      sessionId: session.id, assetTag: session.assetTag, matched, added, sightings: report.sightings,
      units: recorded.map((unit) => ({ partType: unit.partType, partNumber: unit.partNumber, serial: unit.serial, description: unit.description, priceMax: unit.priceMax })),
    });
  }));

  app.get("/api/photos/:fileName", (request, response) => {
    const fileName = path.basename(request.params.fileName);
    if (!/^[0-9a-f-]+\.(jpg|png|webp)$/.test(fileName)) {
      response.status(404).json({ error: "not found" });
      return;
    }
    response.sendFile(path.resolve(photoDirectory(), fileName), (sendError) => {
      if (sendError && !response.headersSent) response.status(404).json({ error: "not found" });
    });
  });

  app.get("/api/lookup", async (request, response) => {
    const query = typeof request.query.q === "string" ? request.query.q.trim() : "";
    if (!query) {
      response.status(400).json({ error: "q is required" });
      return;
    }
    const lookup = await lookupPartNumber(query);
    if (!lookup) {
      response.status(404).json({ error: "not found" });
      return;
    }
    response.json(lookup);
  });

  app.get("/api/sessions/:id/export.csv", asyncRoute(async (request, response) => {
    const session = await getSession(request.params.id);
    if (!session) {
      response.status(404).json({ error: "session not found" });
      return;
    }
    const csv = buildCsv(session, session.units);
    response.setHeader("Content-Type", "text/csv");
    response.setHeader("Content-Disposition", `attachment; filename="teardown-${session.assetTag.replace(/[^\w.-]/g, "_")}.csv"`);
    response.send(csv);
  }));

  app.use("/api", (_request, response) => {
    response.status(404).json({ error: "not found" });
  });

  // Last stop for errors thrown inside routes, e.g. the database being unreachable
  app.use((routeError: unknown, _request: Request, response: Response, _next: NextFunction) => {
    console.error(JSON.stringify({ event: "route_error", message: routeError instanceof Error ? routeError.message : String(routeError) }));
    if (!response.headersSent) response.status(500).json({ error: "server error" });
  });

  return app;
}
