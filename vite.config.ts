import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.join(projectRoot, "web"),
  plugins: [react()],
  resolve: { alias: { "@shared": path.join(projectRoot, "shared/src") } },
  build: { outDir: path.join(projectRoot, "dist"), emptyOutDir: true },
});
