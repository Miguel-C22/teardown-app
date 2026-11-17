import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { createApp } from "./app";
import { loadTlsFiles, localNetworkAddresses } from "./certificates";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
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
    console.log(`Teardown PoC (${isProduction ? "production" : "development"}, ${tlsFiles.source} cert)`);
    for (const address of addresses) console.log(`  https://${address}:${port}`);
  });
}

start().catch((startupError) => {
  console.error(startupError);
  process.exit(1);
});
