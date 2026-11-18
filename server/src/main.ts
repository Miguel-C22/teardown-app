import { existsSync, readFileSync } from "node:fs";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import express from "express";
import { createApp } from "./app";
import { loadTlsFiles, localNetworkAddresses } from "./certificates";
import { visionMode } from "./vision";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
// Secrets such as OPENAI_API_KEY live in .env on this machine only; variables already set (e.g. by tests) win
const envFilePath = path.join(projectRoot, ".env");
if (existsSync(envFilePath)) {
  for (const [name, value] of Object.entries(parseEnv(readFileSync(envFilePath, "utf8")))) {
    if (process.env[name] === undefined && value !== undefined) process.env[name] = value;
  }
}
const port = Number(process.env.PORT ?? 5443);
const isProduction = process.env.NODE_ENV === "production";

async function start(): Promise<void> {
  const app = createApp();
  const tlsFiles = loadTlsFiles(path.join(projectRoot, ".certs"));
  const server = https.createServer({ cert: tlsFiles.cert, key: tlsFiles.key }, app);

  if (isProduction) {
    const distDirectory = path.join(projectRoot, "dist");
    app.use(express.static(distDirectory));
    app.get("*", (_request, response) => response.sendFile(path.join(distDirectory, "index.html")));
  } else {
    // Vite runs inside this server so web and API share one HTTPS origin.
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      configFile: path.join(projectRoot, "vite.config.ts"),
      server: { middlewareMode: true, hmr: { server } },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  server.listen(port, "0.0.0.0", () => {
    const addresses = ["localhost", ...localNetworkAddresses()];
    console.log(`Teardown PoC (${isProduction ? "production" : "development"}, ${tlsFiles.source} cert, vision ${visionMode()})`);
    for (const address of addresses) console.log(`  https://${address}:${port}`);
  });
}

start().catch((startupError) => {
  console.error(startupError);
  process.exit(1);
});
