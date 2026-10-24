import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // The live checks call the real model; run them with npm run test:live.
    exclude: ["tests/live/**", "node_modules/**"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
