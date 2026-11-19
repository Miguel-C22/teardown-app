import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.join(projectRoot, "web"),
  plugins: [react()],
  resolve: {
    alias: [
      { find: "@shared", replacement: path.join(projectRoot, "shared/src") },
      // The text reader only needs plain WebAssembly; the default build adds WebGPU and doubles the download (30 MB vs 15 MB)
      { find: /^onnxruntime-web$/, replacement: "onnxruntime-web/wasm" },
    ],
  },
  build: { outDir: path.join(projectRoot, "dist"), emptyOutDir: true },
  // Pre-bundled at dev start so the lazily imported OCR library doesn't trigger a page reload mid-scan
  optimizeDeps: { include: ["tesseract.js"] },
  // Compiles the app as soon as the dev server starts, so the first page load (and the first e2e test) doesn't time out
  server: { warmup: { clientFiles: ["./src/main.tsx", "./src/scan/CameraScanner.tsx", "./src/scan/decodeWorker.ts"] } },
});
