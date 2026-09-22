import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

// Unit tests for plain TypeScript logic (like the planner). No browser needed.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
})
