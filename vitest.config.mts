import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

// Unit tests for plain TypeScript logic (like the planner). No browser needed.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // "server-only" throws outside a React server; tests import server code directly.
      "server-only": fileURLToPath(new URL("./src/server/test-utils/empty-module.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Many tests start their own in-process Postgres (PGlite); under a full
    // parallel run a few seconds isn't always enough.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
