import express, { type Express } from "express";
import { createSession, getSession, listSessions, addUnit } from "./store.js";
import { buildCsv } from "../../shared/src/csvExport.js";
import { lookupPart } from "./ebay.js";
import { lookupCatalog } from "../../shared/src/catalog.js";

export function createApp(): Express {
  const app = express();
  app.use(express.json({ limit: "10mb" }));

  app.get("/api/health", (_request, response) => {
    response.json({ status: "ok", app: "teardown-poc", time: new Date().toISOString() });
  });

  app.post("/api/sessions", (request, response) => {
    const { assetTag, model } = request.body as { assetTag?: string; model?: string };
    if (!assetTag || !model) {
      response.status(400).json({ error: "assetTag and model are required" });
      return;
    }
    const session = createSession(assetTag.trim(), model.trim());
    response.status(201).json(session);
  });

  app.get("/api/sessions", (_request, response) => {
    response.json(listSessions());
  });

  app.get("/api/sessions/:id", (request, response) => {
    const session = getSession(request.params.id);
    if (!session) {
      response.status(404).json({ error: "session not found" });
      return;
    }
    response.json(session);
  });

  app.post("/api/sessions/:id/units", (request, response) => {
    const { partType, serial } = request.body as { partType?: string; serial?: string | null };
    if (!partType) {
      response.status(400).json({ error: "partType is required" });
      return;
    }
    const unit = addUnit(request.params.id, partType, serial ?? null);
    if (!unit) {
      response.status(404).json({ error: "session not found" });
      return;
    }
    response.status(201).json(unit);
  });

  app.get("/api/lookup", (request, response) => {
    const query = typeof request.query.q === "string" ? request.query.q.trim() : "";
    if (!query) { response.status(400).json({ error: "q is required" }); return; }

    function sendResult(result: { name: string; category: string; priceMin: number; priceMax: number; imageUrl?: string | null; confidence: string; listingCount?: number }, source: string) {
      const recommendation = result.priceMax >= 30 ? "KEEP" : result.priceMax >= 10 ? "REVIEW" : "RECYCLE";
      response.json({ ...result, recommendation, source });
    }

    // Try eBay first (if keys configured), fall back to static catalog
    const hasEbayKeys = !!process.env.EBAY_CLIENT_ID;
    const ebayPromise = hasEbayKeys ? lookupPart(query) : Promise.resolve(null);

    ebayPromise
      .then((ebayResult) => {
        if (ebayResult) { sendResult(ebayResult, "ebay"); return; }
        // eBay unavailable or no results — try static catalog
        const catalogEntry = lookupCatalog(query);
        if (!catalogEntry) { response.status(404).json({ error: "not found" }); return; }
        sendResult({ ...catalogEntry, imageUrl: null, confidence: "medium", listingCount: 0 }, "catalog");
      })
      .catch(() => {
        const catalogEntry = lookupCatalog(query);
        if (!catalogEntry) { response.status(503).json({ error: "lookup unavailable" }); return; }
        sendResult({ ...catalogEntry, imageUrl: null, confidence: "medium", listingCount: 0 }, "catalog");
      });
  });

  app.get("/api/sessions/:id/export.csv", (request, response) => {
    const session = getSession(request.params.id);
    if (!session) {
      response.status(404).json({ error: "session not found" });
      return;
    }
    const csv = buildCsv(session, session.units);
    response.setHeader("Content-Type", "text/csv");
    response.setHeader("Content-Disposition", `attachment; filename="teardown-${session.assetTag}.csv"`);
    response.send(csv);
  });

  app.use("/api", (_request, response) => {
    response.status(404).json({ error: "not found" });
  });

  return app;
}
