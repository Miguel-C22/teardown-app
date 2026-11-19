import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["shared/test/**/*.test.ts", "server/test/**/*.test.ts"],
    environment: "node",
    // Tests never touch Neon; the store contract tests opt in with TEST_DATABASE_URL
    env: { VISION_MODE: "mock", DATABASE_URL: "" },
  },
});
