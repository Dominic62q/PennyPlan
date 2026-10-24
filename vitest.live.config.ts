import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Real-model checks of Penny. Needs OPENCODE_API_KEY (read from .env.local).
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/live/**/*.test.ts"],
    testTimeout: 120_000,
  },
});
