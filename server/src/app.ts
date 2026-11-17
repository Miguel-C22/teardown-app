import express, { type Express } from "express";

export function createApp(): Express {
  const app = express();
  app.use(express.json({ limit: "10mb" }));

  app.get("/api/health", (_request, response) => {
    response.json({ status: "ok", app: "teardown-poc", time: new Date().toISOString() });
  });

  app.use("/api", (_request, response) => {
    response.status(404).json({ error: "not found" });
  });

  return app;
}
