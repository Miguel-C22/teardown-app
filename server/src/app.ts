import path from "node:path";
import express, { type Express, type Response } from "express";
import { buildCsv } from "../../shared/src/csvExport.js";
import type { IdentifiedBy } from "../../shared/src/recommend.js";
import { expectedCountsFromSweeps, remainingByCategory } from "../../shared/src/remaining.js";
import { isNumberReadFromImage, readPartNumber, readSerial } from "../../shared/src/visionSchema.js";
import { buildUnit, savePhoto } from "./identify.js";
import { lookupPartNumber } from "./lookup.js";
import {
  addSweep, addUnit, createSession, getSession, getVisionUsage, listSessions, listSweeps, photoDirectory, recordVisionCall, sessionExists,
  setSessionModelIfEmpty,
} from "./store.js";
import { VisionError, analyzeCloseup, analyzeSweep, visionMode, type VisionRequest } from "./vision.js";

const IDENTIFIED_BY_VALUES: IdentifiedBy[] = ["barcode", "label-read", "visual", "manual"];
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

function sendVisionError(visionError: unknown, response: Response): void {
  if (visionError instanceof VisionError) {
    response.status(visionError.statusCode).json({ error: visionError.message });
    return;
  }
  console.error(visionError);
  response.status(500).json({ error: "vision request failed" });
}

function sessionSummary(sessionId: string) {
  const session = getSession(sessionId);
  if (!session) return undefined;
  const sweeps = listSweeps(sessionId);
  return {
    ...session,
    remaining: remainingByCategory(expectedCountsFromSweeps(sweeps), session.units),
    sweepCount: sweeps.length,
    visionUsage: getVisionUsage(sessionId),
  };
}

export function createApp(): Express {
  const app = express();
  app.use(express.json({ limit: "10mb" }));

  app.get("/api/health", (_request, response) => {
    response.json({ status: "ok", app: "teardown-poc", visionMode: visionMode(), time: new Date().toISOString() });
  });

  app.post("/api/sessions", (request, response) => {
    const { assetTag, model } = request.body as { assetTag?: string; model?: string };
    if (!assetTag?.trim()) {
      response.status(400).json({ error: "assetTag is required" });
      return;
    }
    // The model is optional: the first sweep fills it in from the chassis photo
    response.status(201).json(createSession(assetTag.trim(), model?.trim() ?? ""));
  });

  app.get("/api/sessions", (_request, response) => {
    response.json(listSessions());
  });

  app.get("/api/sessions/:id", (request, response) => {
    const summary = sessionSummary(request.params.id);
    if (!summary) {
      response.status(404).json({ error: "session not found" });
      return;
    }
    response.json(summary);
  });

  app.post("/api/sessions/:id/units", async (request, response) => {
    const body = request.body as {
      partType?: string; serial?: string | null; partNumber?: string | null; manufacturer?: string | null;
      description?: string | null; identifiedBy?: string; evidence?: string | null; partNumberRead?: boolean;
    };
    if (!body.partType) {
      response.status(400).json({ error: "partType is required" });
      return;
    }
    if (!sessionExists(request.params.id)) {
      response.status(404).json({ error: "session not found" });
      return;
    }
    const identifiedBy = IDENTIFIED_BY_VALUES.includes(body.identifiedBy as IdentifiedBy) ? body.identifiedBy as IdentifiedBy : "barcode";
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
    });
    const added = addUnit(request.params.id, newUnit);
    if (!added) {
      response.status(404).json({ error: "session not found" });
      return;
    }
    response.status(added.duplicate ? 200 : 201).json({ ...added.unit, duplicate: added.duplicate });
  });

  app.post("/api/sessions/:id/vision/sweep", async (request, response) => {
    const session = getSession(request.params.id);
    if (!session) {
      response.status(404).json({ error: "session not found" });
      return;
    }
    const image = readImageBody(request.body as ImageBody, response);
    if (!image) return;
    try {
      const vision = await analyzeSweep({ ...image, serverModel: session.model || null });
      recordVisionCall(session.id, "sweep", vision.mode, vision.usage.inputTokens, vision.usage.outputTokens, vision.usage.costUsd);
      const photoPath = image.imageBase64 ? savePhoto(image.imageBase64, image.mediaType) : null;
      const sweep = addSweep(session.id, vision.result.countsByCategory, vision.result.chassisModelGuess, photoPath);
      if (!session.model && vision.result.chassisModelGuess) setSessionModelIfEmpty(session.id, vision.result.chassisModelGuess);

      // Sequential so two parts with the same serial can't both be added
      const parts = [];
      for (const [index, part] of vision.result.parts.entries()) {
        const partNumber = readPartNumber(part);
        const serial = readSerial(part);
        const lookup = partNumber ? await lookupPartNumber(partNumber) : null;
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
          const added = addUnit(session.id, newUnit);
          unitId = added?.unit.id ?? null;
          duplicate = added?.duplicate ?? false;
        }
        parts.push({ ...part, index, partNumber, serial, lookup, unitId, duplicate });
      }

      response.json({ sweepId: sweep.id, mode: vision.mode, usage: vision.usage, chassisModelGuess: vision.result.chassisModelGuess, parts, session: sessionSummary(session.id) });
    } catch (visionError) {
      sendVisionError(visionError, response);
    }
  });

  app.post("/api/sessions/:id/vision/closeup", async (request, response) => {
    const session = getSession(request.params.id);
    if (!session) {
      response.status(404).json({ error: "session not found" });
      return;
    }
    const body = request.body as ImageBody;
    const image = readImageBody(body, response);
    if (!image) return;
    try {
      const vision = await analyzeCloseup({ ...image, serverModel: session.model || null, categoryHint: body.categoryHint ?? null });
      recordVisionCall(session.id, "closeup", vision.mode, vision.usage.inputTokens, vision.usage.outputTokens, vision.usage.costUsd);
      const reading = vision.result;
      const partNumberRead = isNumberReadFromImage(reading.partNumber, reading.printedText);
      const serialRead = isNumberReadFromImage(reading.serial, reading.printedText);
      const legibleText = reading.printedText.filter((printed) => printed.readFromImage).map((printed) => printed.text);
      const unconfirmed = [
        !partNumberRead && reading.partNumber ? `unconfirmed part number ${reading.partNumber}` : null,
        !serialRead && reading.serial ? `unconfirmed serial ${reading.serial}` : null,
      ].filter((note): note is string => note !== null);
      const photoPath = image.imageBase64 ? savePhoto(image.imageBase64, image.mediaType) : null;

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
      });
      const added = addUnit(session.id, newUnit);
      if (!added) {
        response.status(404).json({ error: "session not found" });
        return;
      }
      response.json({ unit: added.unit, duplicate: added.duplicate, lookup, reading, mode: vision.mode, usage: vision.usage, session: sessionSummary(session.id) });
    } catch (visionError) {
      sendVisionError(visionError, response);
    }
  });

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

  app.get("/api/sessions/:id/export.csv", (request, response) => {
    const session = getSession(request.params.id);
    if (!session) {
      response.status(404).json({ error: "session not found" });
      return;
    }
    const csv = buildCsv(session, session.units);
    response.setHeader("Content-Type", "text/csv");
    response.setHeader("Content-Disposition", `attachment; filename="teardown-${session.assetTag.replace(/[^\w.-]/g, "_")}.csv"`);
    response.send(csv);
  });

  app.use("/api", (_request, response) => {
    response.status(404).json({ error: "not found" });
  });

  return app;
}
