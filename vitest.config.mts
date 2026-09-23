import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

// Unit and integration tests (Node), plus a few component tests (jsdom).
export default defineConfig({
  // Component tests are compiled with React's automatic JSX runtime.
  oxc: { jsx: { runtime: "automatic" } },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // "server-only" throws outside a React server; tests import server code directly.
      "server-only": fileURLToPath(new URL("./src/server/test-utils/empty-module.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    // .test.tsx = React component tests (they opt into a simulated browser with
    // "@vitest-environment jsdom" at the top of the file).
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // Many tests start their own in-process Postgres (PGlite); under a full
    // parallel run a few seconds isn't always enough.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
